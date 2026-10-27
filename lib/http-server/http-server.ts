/*!
 * lib/http-server/http-server.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import type { Server } from "node:http";
import { App } from "@tinyhttp/app";
import helmet from "helmet";
import nocache from "nocache";
import sirv from "sirv";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import errors from "../errors.js";
import Logger from "../logger.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */

/**
 * HTTP server
 */
class HttpServer {
	declare static HELMET_POLICY: Parameters<typeof helmet>[0];
	declare host: string;
	declare port: number;
	declare server: Server | null;
	declare app: App;
	/**
	 * Constructor
	 */
	constructor(port: number, host?: string) {
		// Initialize server host and port
		this.host = host ?? "127.0.0.1";
		this.port = port;

		// Listening server instance
		this.server = null;

		// Initialize the tiny-http app
		this.app = new App({
			noMatchHandler: (req: HttpRequestLike, res: HttpResponseLike) => {
				Logger.error(
					null,
					`HttpServer : 404 - Not found: ${req.method} - ${req.hostname}${req.path}`,
				);
				HttpServer.sendError(res, { status: "404 - Not found" }, 404);
			},
			// Error handler
			onError: (
				error: unknown,
				_req: HttpRequestLike,
				res: HttpResponseLike,
			) => {
				// Detect if this is auth error
				if (
					typeof error === "string" &&
					Object.values(errors.auth).includes(error)
				) {
					HttpServer.sendError(res, error, 401);
				} else {
					const logPayload =
						error instanceof Error ? error.stack || error : error;
					Logger.error(logPayload, "HttpServer : general error");
					const returnValue: Record<string, string> = {
						status: "Server error",
					};
					HttpServer.sendError(res, returnValue, 500);
				}
			},
		});

		// Middlewares for json responses and requests logging
		this.app.use(HttpServer.requestLogger);
		this.app.use(HttpServer.setCrossOrigin);
		this.app.use(helmet(HttpServer.HELMET_POLICY));
		this.app.use(nocache());

		this.app.use("/static", sirv("../static"));

		this.app.use(
			(
				_req: HttpRequestLike,
				res: HttpResponseLike,
				next: NextFunctionLike,
			) => {
				res.append("X-Dojo-Version", keys.dojoVersion);
				next();
			},
		);

		this.app.use(HttpServer.setJSONResponse);
		this.app.use(HttpServer.setConnection);
	}

	/**
	 * Start the http server
	 */
	start() {
		// Start a http server
		this.server = this.app.listen(
			this.port,
			() => {
				Logger.info(`HttpServer : Listening on ${this.host}:${this.port}`);
			},
			this.host,
		);

		this.server.timeout = 600 * 1000;
		// @see https://github.com/nodejs/node/issues/13391
		this.server.keepAliveTimeout = 0;

		return this.server;
	}

	/**
	 * Stop the http server
	 */
	stop() {
		if (this.server == null) return;
		this.server.close();
	}

	/**
	 * Return a http response without data
	 */
	static sendOk(res: HttpResponseLike) {
		const returnValue = { status: "ok" };
		res.status(200).json(returnValue);
	}

	/**
	 * Return a http response without status
	 */
	static sendOkDataOnly(res: HttpResponseLike, data?: unknown) {
		res.status(200).json(data);
	}

	/**
	 * Return a http response with status and data
	 */
	static sendOkData(res: HttpResponseLike, data?: unknown) {
		const returnValue = {
			status: "ok",
			data: data,
		};
		res.status(200).json(returnValue);
	}

	/**
	 * Return a http response with raw data
	 */
	static sendRawData(res: HttpResponseLike, data?: unknown) {
		res.status(200).send(data);
	}

	/**
	 * Return an error response
	 */
	static sendError(res: HttpResponseLike, data?: unknown, errorCode?: number) {
		if (errorCode == null) errorCode = 400;

		if (data instanceof Error) {
			Logger.error(data, "API: Unhandled error");
			data = errors.generic.GEN;
		}

		const returnValue = {
			status: "error",
			error: data,
		};

		res.status(errorCode).json(returnValue);
	}

	/*
	 * A middleware returning an authorization error response
	 */
	static sendAuthError(res: HttpResponseLike, error?: unknown): void;
	static sendAuthError(
		_req: HttpRequestLike,
		_res: HttpResponseLike,
		_next: NextFunctionLike,
	): void;
	static sendAuthError(
		first: HttpRequestLike | HttpResponseLike,
		second?: unknown,
		_next?: NextFunctionLike,
	) {
		const res =
			second != null && typeof second === "object" && "status" in second
				? (second as HttpResponseLike)
				: (first as HttpResponseLike);
		const error = res === first ? second : undefined;
		if (error) {
			HttpServer.sendError(res, error, 401);
		}
	}

	/**
	 * Express middleware returnsing a json response
	 */
	static setJSONResponse(
		_req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		res.set("Content-Type", "application/json");
		next();
	}

	/**
	 * Express middleware adding cors header
	 */
	static setCrossOrigin(
		_req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		res.set("Access-Control-Allow-Origin", "*");
		res.set("Access-Control-Allow-Methods", "GET,HEAD,POST,DELETE");
		res.set(
			"Access-Control-Allow-Headers",
			"Content-Type,Authorization,Accept",
		);
		next();
	}

	/**
	 * Express middleware adding connection header
	 */
	static setConnection(
		_req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		res.set("Connection", "close");
		next();
	}

	/**
	 * Express middleware logging url and methods called
	 */
	static requestLogger(
		req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		const method = req.method;
		const url = req.originalUrl;

		res.on("finish", () => {
			Logger.info(`HttpServer : ${res.statusCode} - ${method} ${url}`);
		});
		next();
	}
}

/**
 * Helmet Policy
 */
HttpServer.HELMET_POLICY = {
	contentSecurityPolicy: {
		useDefaults: false,
		directives: {
			"default-src": ["'self'", "data:"],
			"base-uri": ["'self'"],
			"font-src": ["'self'", "https:", "data:"],
			"frame-ancestors": ["'self'"],
			"img-src": [
				"'self'",
				"data:",
				"http://paynym25chftmsywv4v2r67agbrr62lcxagsf4tymbzpeeucucy2ivad.onion",
			],
			"object-src": ["'none'"],
			"script-src": ["'self'", "'unsafe-inline'"],
			"style-src": ["'self'", "https:", "'unsafe-inline'"],
			"media-src": ["'self'", "data:"],
		},
	},
	dnsPrefetchControl: true,
	frameguard: true,
	hidePoweredBy: true,
	ieNoOpen: true,
	noSniff: true,
	referrerPolicy: true,
	xssFilter: true,
};

export default HttpServer;

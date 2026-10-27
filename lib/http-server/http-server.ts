/*!
 * lib/http-server/http-server.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { statSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import errors from "../errors.js";
import Logger from "../logger.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

class HttpServer {
	host: string;
	port: number;
	server: Server | null = null;
	app: Hono<HttpEnv>;

	constructor(port: number, host = "127.0.0.1", staticRoot = "../static") {
		this.host = host;
		this.port = port;
		this.app = new Hono<HttpEnv>({ strict: false });
		this.app.notFound((c) => {
			Logger.error(
				null,
				`HttpServer : 404 - Not found: ${c.req.method} - ${new URL(c.req.url).hostname}${c.req.path}`,
			);
			HttpServer.sendError(c, { status: "404 - Not found" }, 404);
			return c.res;
		});
		this.app.onError((error, c) => {
			if (Object.values(errors.auth).includes(error.message)) {
				HttpServer.sendError(c, error.message, 401);
			} else {
				Logger.error(error.stack || error, "HttpServer : general error");
				HttpServer.sendError(c, { status: "Server error" }, 500);
			}
			return c.res;
		});

		this.app.use(async (c, next) => {
			await next();
			Logger.info(
				`HttpServer : ${c.res.status} - ${c.req.method} ${c.req.path}${new URL(c.req.url).search}`,
			);
		});
		this.app.use(
			secureHeaders({
				strictTransportSecurity: "max-age=31536000; includeSubDomains",
				contentSecurityPolicy: {
					defaultSrc: ["'self'", "data:"],
					baseUri: ["'self'"],
					fontSrc: ["'self'", "https:", "data:"],
					frameAncestors: ["'self'"],
					imgSrc: [
						"'self'",
						"data:",
						"http://paynym25chftmsywv4v2r67agbrr62lcxagsf4tymbzpeeucucy2ivad.onion",
					],
					objectSrc: ["'none'"],
					scriptSrc: ["'self'", "'unsafe-inline'"],
					styleSrc: ["'self'", "https:", "'unsafe-inline'"],
					mediaSrc: ["'self'", "data:"],
				},
			}),
		);
		this.app.use(async (c, next) => {
			c.header("Access-Control-Allow-Origin", "*");
			c.header("Access-Control-Allow-Methods", "GET,HEAD,POST,DELETE");
			c.header(
				"Access-Control-Allow-Headers",
				"Content-Type,Authorization,Accept",
			);
			c.header("Surrogate-Control", "no-store");
			c.header(
				"Cache-Control",
				"no-store, no-cache, must-revalidate, proxy-revalidate",
			);
			c.header("Expires", "0");
			await next();
		});

		this.app.use("/static/*", async (c, next) => {
			// Match sirv's hidden-file policy, while retaining .well-known resources.
			let pathname: string;
			try {
				pathname = decodeURI(c.req.path).replace(/^\/static/, "");
			} catch {
				return next();
			}
			if (
				!pathname.includes("/.well-known/") &&
				pathname.split("/").some((part) => part.startsWith("."))
			)
				return next();
			return serveStatic({
				root: staticRoot,
				allowPercentInPath: true,
				rewriteRequestPath: () => {
					const base = pathname.replace(/\/$/, "");
					// Retain extensionless HTML URLs as well as directory indexes.
					for (const ext of ["", ".html", ".htm"]) {
						for (const candidate of [base + ext, `${base}/index${ext}`]) {
							try {
								if (statSync(join(staticRoot, candidate)).isFile())
									return candidate;
							} catch {}
						}
					}
					return pathname;
				},
			})(c, next);
		});

		this.app.use(async (c, next) => {
			c.header("X-Dojo-Version", keys.dojoVersion);
			c.header("Content-Type", "application/json");
			c.header("Connection", "close");
			c.set("body", {});
			await next();
		});
	}

	start() {
		this.server = serve({
			fetch: this.app.fetch,
			port: this.port,
			hostname: this.host,
		}) as Server;
		this.server.on("listening", () => {
			Logger.info(`HttpServer : Listening on ${this.host}:${this.port}`);
		});
		this.server.timeout = 600 * 1000;
		this.server.keepAliveTimeout = 0;
		return this.server;
	}

	stop() {
		this.server?.close();
	}

	private static readonly limitBody = bodyLimit({
		maxSize: 100 * 1024,
		onError: () => {
			throw new Error("Payload too large");
		},
	});

	static async parseJson(c: HttpContext, next: HttpNext) {
		return HttpServer.limitBody(c, async () => {
			const text = await c.req.text();
			c.set("body", text.length ? await c.req.json<UnknownRecord>() : {});
			await next();
		});
	}

	static async parseForm(c: HttpContext, next: HttpNext) {
		return HttpServer.limitBody(c, async () => {
			// Existing clients may omit the content type. Keep the original last-value
			// semantics for repeated fields, including literal field names ending in [].
			c.set(
				"body",
				Object.fromEntries(new URLSearchParams(await c.req.text())),
			);
			await next();
		});
	}

	static sendOk(c: HttpContext) {
		c.res = c.json({ status: "ok" }, 200);
	}

	static sendOkDataOnly(c: HttpContext, data?: unknown) {
		c.res = c.json(data, 200);
	}

	static sendOkData(c: HttpContext, data?: unknown) {
		c.res = c.json({ status: "ok", data }, 200);
	}

	static sendRawData(c: HttpContext, data?: unknown) {
		c.res = typeof data === "string" ? c.body(data, 200) : c.json(data, 200);
	}

	static sendError(c: HttpContext, data?: unknown, errorCode = 400) {
		if (data instanceof Error) {
			Logger.error(data, "API: Unhandled error");
			data = errors.generic.GEN;
		}
		c.res = c.json(
			{ status: "error", error: data },
			errorCode as ContentfulStatusCode,
		);
	}

	static sendAuthError(c: HttpContext, error?: unknown) {
		if (error) HttpServer.sendError(c, error, 401);
	}
}

export default HttpServer;

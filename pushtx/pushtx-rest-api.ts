/*!
 * pushtx/pushtx-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import qs from "node:querystring";
import { json } from "milliparsec";
import validator from "validator";
import keysFile from "../keys/index.js";
import authMgr from "../lib/auth/authorizations-manager.js";
import network from "../lib/bitcoin/network.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import pushTxProcessor from "./pushtx-processor.js";
import status from "./status.js";
import TransactionsScheduler, {
	type ScheduledTxScriptEntry,
} from "./transactions-scheduler.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

interface TraceErrorLike {
	message?: unknown;
}

interface ErrorMessagePayload {
	code: unknown;
	message: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value != null && typeof value === "object" && !Array.isArray(value);

const hasMessage = (value: unknown): value is TraceErrorLike =>
	isRecord(value) && "message" in value;

const isErrorMessagePayload = (value: unknown): value is ErrorMessagePayload =>
	isRecord(value) && "code" in value && "message" in value;

const queryStringValue = (value: unknown): string | null => {
	if (typeof value === "string") return value;
	if (Array.isArray(value) && typeof value[0] === "string") return value[0];
	return null;
};

const isScheduledTxScriptEntry = (
	value: unknown,
): value is ScheduledTxScriptEntry => {
	if (!isRecord(value)) return false;
	const vouts = value.strict_mode_vouts;
	return (
		typeof value.tx === "string" &&
		typeof value.hop === "number" &&
		typeof value.nlocktime === "number" &&
		(vouts === undefined ||
			(Array.isArray(vouts) && vouts.every((vout) => typeof vout === "number")))
	);
};

const isScheduledTxScript = (
	value: unknown,
): value is ScheduledTxScriptEntry[] =>
	Array.isArray(value) && value.every(isScheduledTxScriptEntry);

/**
 * PushTx API endpoints
 */
class PushTxRestApi {
	declare httpServer: HttpServer;
	declare scheduler: TransactionsScheduler;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;
		this.scheduler = new TransactionsScheduler();

		// Establish routes
		const jsonParser = json();

		// Establish routes. Proxy server strips /pushtx
		this.httpServer.app.post(
			"/schedule",
			jsonParser,
			authMgr.checkAuthentication.bind(authMgr),
			this.postScheduleTxs.bind(this),
		);

		this.httpServer.app.post(
			"/",
			authMgr.checkAuthentication.bind(authMgr),
			this.postPushTx.bind(this),
		);

		this.httpServer.app.get(
			"/",
			authMgr.checkAuthentication.bind(authMgr),
			this.getPushTx.bind(this),
		);

		this.httpServer.app.get(
			`/${keys.prefixes.statusPushtx}/`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.getStatus.bind(this),
		);

		this.httpServer.app.get(
			`/${keys.prefixes.statusPushtx}/schedule`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.getStatusSchedule.bind(this),
		);

		// Handle unknown paths, returning a help message
		this.httpServer.app.get(
			"/*",
			authMgr.checkAuthentication.bind(authMgr),
			this.getHelp.bind(this),
		);
	}

	/**
	 * Handle Help GET request
	 */
	getHelp(_req: HttpRequestLike, res: HttpResponseLike) {
		const returnValue = {
			endpoints: ["/pushtx", "/pushtx/schedule"],
		};
		HttpServer.sendError(res, returnValue, 404);
	}

	/**
	 * Handle Status GET request
	 */
	async getStatus(_req: HttpRequestLike, res: HttpResponseLike) {
		try {
			const currentStatus = await status.getCurrent();
			HttpServer.sendOkData(res, currentStatus);
		} catch (error) {
			this._traceError(res, error);
		}
	}

	/**
	 * Handle status/schedule GET request
	 */
	async getStatusSchedule(_req: HttpRequestLike, res: HttpResponseLike) {
		try {
			const returnValue = await status.getScheduledTransactions();
			HttpServer.sendOkData(res, returnValue);
		} catch (error) {
			this._traceError(res, error);
		}
	}

	/**
	 * Handle pushTx GET request
	 */
	getPushTx(_req: HttpRequestLike, res: HttpResponseLike) {
		const returnValue = errors.get.DISALLOWED;
		HttpServer.sendError(res, returnValue, 405);
	}

	/**
	 * Handle POST req.
	 * Push transactions to the Bitcoin network
	 */
	postPushTx(req: HttpRequestLike, res: HttpResponseLike) {
		// Accumulate POST data
		const chunks: Array<Buffer | string> = [];

		req.on("data", (chunk) => {
			chunks.push(chunk);
		});

		req.on("end", async () => {
			const body = chunks.join("");
			const query = qs.parse(body);
			const tx = queryStringValue(query.tx);
			const strictModeVouts = queryStringValue(query.strict_mode_vouts);

			if (tx == null) return this._traceError(res, errors.body.NOTX);

			if (!validator.isHexadecimal(tx))
				return this._traceError(res, errors.body.INVDATA);

			if (strictModeVouts != null) {
				try {
					const vouts = strictModeVouts
						.split("|")
						.map((v) => Number.parseInt(v, 10));
					if (vouts.some((vout) => Number.isNaN(vout))) throw errors.txout.VOUT;
					if (vouts.length > 0) {
						const faults = await pushTxProcessor.enforceStrictModeVouts(
							tx,
							vouts,
						);
						if (faults.length > 0) {
							return this._traceError(
								res,
								{
									message: JSON.stringify({
										message: faults,
										code: errors.pushtx.VIOLATION_STRICT_MODE_VOUTS,
									}),
								},
								200,
							);
						}
					}
				} catch (error) {
					return this._traceError(res, error);
				}
			}

			try {
				const txid = await pushTxProcessor.pushTx(tx);
				HttpServer.sendOkData(res, txid);
			} catch (error) {
				this._traceError(res, error);
			}
		});
	}

	/**
	 * Schedule a list of transactions
	 * for delayed pushes
	 */
	async postScheduleTxs(req: HttpRequestLike, res: HttpResponseLike) {
		// Check req.arguments
		if (!req.body) return this._traceError(res, errors.body.NODATA);

		if (!req.body.script) return this._traceError(res, errors.body.NOSCRIPT);
		if (!isScheduledTxScript(req.body.script))
			return this._traceError(res, errors.body.INVDATA);

		try {
			await this.scheduler.schedule(req.body.script);
			HttpServer.sendOk(res);
		} catch (error) {
			// Returns code 200 if VIOLATION_STRICT_MODE_VOUTS
			if (
				hasMessage(error) &&
				isErrorMessagePayload(error.message) &&
				error.message.code === errors.pushtx.VIOLATION_STRICT_MODE_VOUTS
			) {
				this._traceError(res, { message: JSON.stringify(error.message) }, 200);
			} else {
				this._traceError(res, error);
			}
		}
	}

	/**
	 * Trace an error during push
	 */
	_traceError(res: HttpResponseLike, error?: unknown, errorCode?: number) {
		let returnValue: unknown = null;

		errorCode = errorCode == null ? 400 : errorCode;

		try {
			if (hasMessage(error) && typeof error.message === "string") {
				let message: unknown = {};
				try {
					message = JSON.parse(error.message) as unknown;
				} catch {}

				if (isErrorMessagePayload(message)) {
					Logger.error(
						null,
						`PushTx : Error ${message.code}: ${message.message}`,
					);
					returnValue = message;
				} else {
					Logger.error(error.message, "PushTx : ");
					returnValue = error.message;
				}
			} else {
				Logger.error(error, "PushTx : ");
				returnValue = error;
			}
		} catch (error) {
			Logger.error(error, "PushTx : ");
			returnValue = error;
		} finally {
			HttpServer.sendError(res, returnValue, errorCode);
		}
	}
}

export default PushTxRestApi;

/*!
 * pushtx/pushtx-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

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

		// Establish routes. Proxy server strips /pushtx
		this.httpServer.app.post(
			"/schedule",
			HttpServer.parseJson,
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
			`/${keys.prefixes.statusPushtx}`,
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
	async getHelp(c: HttpContext) {
		const returnValue = {
			endpoints: ["/pushtx", "/pushtx/schedule"],
		};
		HttpServer.sendError(c, returnValue, 404);
	}

	/**
	 * Handle Status GET request
	 */
	async getStatus(c: HttpContext) {
		try {
			const currentStatus = await status.getCurrent();
			HttpServer.sendOkData(c, currentStatus);
		} catch (error) {
			this._traceError(c, error);
		}
	}

	/**
	 * Handle status/schedule GET request
	 */
	async getStatusSchedule(c: HttpContext) {
		try {
			const returnValue = await status.getScheduledTransactions();
			HttpServer.sendOkData(c, returnValue);
		} catch (error) {
			this._traceError(c, error);
		}
	}

	/**
	 * Handle pushTx GET request
	 */
	async getPushTx(c: HttpContext) {
		const returnValue = errors.get.DISALLOWED;
		HttpServer.sendError(c, returnValue, 405);
	}

	/**
	 * Handle POST req.
	 * Push transactions to the Bitcoin network
	 */
	async postPushTx(c: HttpContext) {
		// Parse the raw form body even when clients omit Content-Type.
		const query = new URLSearchParams(await c.req.text());
		const tx = query.get("tx");
		const strictModeVouts = query.get("strict_mode_vouts");

		if (tx == null) return this._traceError(c, errors.body.NOTX);

		if (!validator.isHexadecimal(tx))
			return this._traceError(c, errors.body.INVDATA);

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
							c,
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
				return this._traceError(c, error);
			}
		}

		try {
			const txid = await pushTxProcessor.pushTx(tx);
			HttpServer.sendOkData(c, txid);
		} catch (error) {
			this._traceError(c, error);
		}
	}

	/**
	 * Schedule a list of transactions
	 * for delayed pushes
	 */
	async postScheduleTxs(c: HttpContext) {
		const body = c.get("body");
		// Check req.arguments
		if (!body) return this._traceError(c, errors.body.NODATA);

		if (!body.script) return this._traceError(c, errors.body.NOSCRIPT);
		if (!isScheduledTxScript(body.script))
			return this._traceError(c, errors.body.INVDATA);

		try {
			await this.scheduler.schedule(body.script);
			HttpServer.sendOk(c);
		} catch (error) {
			// Returns code 200 if VIOLATION_STRICT_MODE_VOUTS
			if (
				hasMessage(error) &&
				isErrorMessagePayload(error.message) &&
				error.message.code === errors.pushtx.VIOLATION_STRICT_MODE_VOUTS
			) {
				this._traceError(c, { message: JSON.stringify(error.message) }, 200);
			} else {
				this._traceError(c, error);
			}
		}
	}

	/**
	 * Trace an error during push
	 */
	_traceError(c: HttpContext, error?: unknown, errorCode?: number) {
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
			HttpServer.sendError(c, returnValue, errorCode);
		}
	}
}

export default PushTxRestApi;

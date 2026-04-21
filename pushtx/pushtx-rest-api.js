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
import TransactionsScheduler from "./transactions-scheduler.js";

const keys = keysFile[network.key];

/**
 * PushTx API endpoints
 */
class PushTxRestApi {
	/**
	 * Constructor
	 * @param {HttpServer} httpServer - HTTP server
	 */
	constructor(httpServer) {
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
	 * @param {object} req - http req.object
	 * @param {object} res - http response object
	 */
	getHelp(_req, res) {
		const returnValue = { endpoints: ["/pushtx", "/pushtx/schedule"] };
		HttpServer.sendError(res, returnValue, 404);
	}

	/**
	 * Handle Status GET request
	 * @param {object} req - http req.object
	 * @param {object} res - http response object
	 */
	async getStatus(_req, res) {
		try {
			const currentStatus = await status.getCurrent();
			HttpServer.sendOkData(res, currentStatus);
		} catch (error) {
			this._traceError(res, error);
		}
	}

	/**
	 * Handle status/schedule GET request
	 * @param {object} req - http req.object
	 * @param {object} res - http response object
	 */
	async getStatusSchedule(_req, res) {
		try {
			const returnValue = await status.getScheduledTransactions();
			HttpServer.sendOkData(res, returnValue);
		} catch (error) {
			this._traceError(res, error);
		}
	}

	/**
	 * Handle pushTx GET request
	 * @param {object} req - http req.object
	 * @param {object} res - http response object
	 */
	getPushTx(_req, res) {
		const returnValue = errors.get.DISALLOWED;
		HttpServer.sendError(res, returnValue, 405);
	}

	/**
	 * Handle POST req.
	 * Push transactions to the Bitcoin network
	 * @param {object} req - http req.object
	 * @param {object} res - http response object
	 */
	postPushTx(req, res) {
		// Accumulate POST data
		const chunks = [];

		req.on("data", (chunk) => {
			chunks.push(chunk);
		});

		req.on("end", async () => {
			const body = chunks.join("");
			const query = qs.parse(body);

			if (!query.tx) return this._traceError(res, errors.body.NOTX);

			if (!validator.isHexadecimal(query.tx))
				return this._traceError(res, errors.body.INVDATA);

			if (query.strict_mode_vouts) {
				try {
					const vouts = query.strict_mode_vouts
						.split("|")
						.map((v) => Number.parseInt(v, 10));
					if (vouts.some((vout) => Number.isNaN(vout))) throw errors.txout.VOUT;
					if (vouts.length > 0) {
						const faults = await pushTxProcessor.enforceStrictModeVouts(
							query.tx,
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
				const txid = await pushTxProcessor.pushTx(query.tx);
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
	async postScheduleTxs(req, res) {
		// Check req.arguments
		if (!req.body) return this._traceError(res, errors.body.NODATA);

		if (!req.body.script) return this._traceError(res, errors.body.NOSCRIPT);

		try {
			await this.scheduler.schedule(req.body.script);
			HttpServer.sendOk(res);
		} catch (error) {
			// Returns code 200 if VIOLATION_STRICT_MODE_VOUTS
			if (
				error.message?.code &&
				error.message.code === errors.pushtx.VIOLATION_STRICT_MODE_VOUTS
			) {
				error.message = JSON.stringify(error.message);
				this._traceError(res, error, 200);
			} else {
				this._traceError(res, error);
			}
		}
	}

	/**
	 * Trace an error during push
	 * @param {object} res - http response object
	 * @param {object} error - error object
	 * @param {number} errorCode - error code (optional)
	 */
	_traceError(res, error, errorCode) {
		let returnValue = null;

		errorCode = errorCode == null ? 400 : errorCode;

		try {
			if (error.message) {
				let message = {};
				try {
					message = JSON.parse(error.message);
				} catch {}

				if (message.code && message.message) {
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

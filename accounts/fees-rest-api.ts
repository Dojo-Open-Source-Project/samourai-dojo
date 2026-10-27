/*!
 * accounts/get-fees-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import authMgr from "../lib/auth/authorizations-manager.js";
import rpcFees from "../lib/bitcoind-rpc/fees.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";

const debugApi = process.argv.includes("api-debug");

/**
 * A singleton providing util methods used by the API
 */
class FeesRestApi {
	[key: string]: unknown;
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;
		// Establish routes
		this.httpServer.app.get(
			"/fees",
			authMgr.checkAuthentication.bind(authMgr),
			this.getFees,
		);
		this.httpServer.app.post(
			"/fees",
			authMgr.checkAuthentication.bind(authMgr),
			this.getFees,
		);
		this.httpServer.app.get(
			"/fees/estimator",
			authMgr.checkAuthentication.bind(authMgr),
			this.getEstimatorFees,
		);
		// Refresh the network fees
		rpcFees.refresh();
	}

	/**
	 * Refresh and return the current fees
	 */
	async getFees(c: HttpContext) {
		try {
			const fees = await rpcFees.getFees();
			HttpServer.sendOkDataOnly(c, fees);
		} catch (error) {
			HttpServer.sendError(c, error);
		} finally {
			debugApi && Logger.info("API : Completed GET /fees");
		}
	}

	/**
	 * Get fees from $1 Fee Estimator
	 */
	async getEstimatorFees(c: HttpContext) {
		try {
			const fees = await rpcFees.getEstimatorFees();
			HttpServer.sendOkDataOnly(c, fees);
		} catch (error) {
			HttpServer.sendError(c, error, 503);
		}
	}
}

export default FeesRestApi;

/*!
 * accounts/status-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../keys/index.js";
import authMgr from "../lib/auth/authorizations-manager.js";
import network from "../lib/bitcoin/network.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import status from "./status.js";

const keys = keysFile[network.key];
const debugApi = process.argv.includes("api-debug");

/**
 * Status API endpoints
 */
class StatusRestApi {
	/**
	 * Constructor
	 * @param {HttpServer} httpServer - HTTP server
	 */
	constructor(httpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.get(
			`/${keys.prefixes.status}/`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.getStatus.bind(this),
		);
	}

	/**
	 * Return information about the api
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async getStatus(_req, res) {
		try {
			const currentStatus = await status.getCurrent();
			HttpServer.sendRawData(res, JSON.stringify(currentStatus, null, 2));
		} catch (error) {
			HttpServer.sendError(res, error);
		} finally {
			debugApi && Logger.info("API : Completed GET /status");
		}
	}
}

export default StatusRestApi;

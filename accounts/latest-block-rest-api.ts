/*!
 * accounts/seen-rest-api.js
 * Copyright © 2023 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import authMgr from "../lib/auth/authorizations-manager.js";
import rpcLatestBlock from "../lib/bitcoind-rpc/latest-block.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";

const debugApi = process.argv.includes("api-debug");

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */

/**
 * Headers API endpoints
 */
class LatestBlockRestApi {
	[key: string]: unknown;
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.get(
			"/latest-block",
			authMgr.checkAuthentication.bind(authMgr),
			this.getLatestBlock.bind(this),
		);
	}

	/**
	 * Handle /latest-block GET request
	 */
	async getLatestBlock(_req: HttpRequestLike, res: HttpResponseLike) {
		const latestBlock = {
			height: rpcLatestBlock.height,
			hash: rpcLatestBlock.hash,
			time: rpcLatestBlock.time,
		};

		HttpServer.sendOkDataOnly(res, latestBlock);

		if (debugApi) {
			Logger.info("API : Completed GET /latest-block");
		}
	}
}

export default LatestBlockRestApi;

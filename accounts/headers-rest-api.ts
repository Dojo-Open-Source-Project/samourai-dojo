/*!
 * accounts/headers-fees-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import validator from "validator";
import authMgr from "../lib/auth/authorizations-manager.js";
import rpcHeaders from "../lib/bitcoind-rpc/headers.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";

const debugApi = process.argv.includes("api-debug");

/**
 * Headers API endpoints
 */
class HeadersRestApi {
	[key: string]: unknown;
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.get(
			"/header/:hash",
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsGetHeader.bind(this),
			this.getHeader.bind(this),
		);
	}

	/**
	 * Retrieve the block header for a given hash
	 */
	async getHeader(c: HttpContext) {
		try {
			const header = await rpcHeaders.getHeader(c.req.param("hash"));
			HttpServer.sendRawData(c, header);
		} catch (error) {
			HttpServer.sendError(c, error);
		} finally {
			debugApi &&
				Logger.info(`API : Completed GET /header/${c.req.param("hash")}`);
		}
	}

	/**
	 * Validate request arguments
	 */
	async validateArgsGetHeader(c: HttpContext, next: HttpNext) {
		const isValidHash = validator.isHash(c.req.param("hash"), "sha256");

		if (isValidHash) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				c.req.param("hash"),
				"API : HeadersRestApi.validateArgsGetHeader() : Invalid hash",
			);
		}
	}
}

export default HeadersRestApi;

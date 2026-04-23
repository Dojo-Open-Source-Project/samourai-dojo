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
	/**
	 * Constructor
	 * @param {HttpServer} httpServer - HTTP server
	 */
	constructor(httpServer) {
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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async getHeader(req, res) {
		try {
			const header = await rpcHeaders.getHeader(req.params.hash);
			HttpServer.sendRawData(res, header);
		} catch (error) {
			HttpServer.sendError(res, error);
		} finally {
			debugApi && Logger.info(`API : Completed GET /header/${req.params.hash}`);
		}
	}

	/**
	 * Validate request arguments
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 * @param {function} next - next tiny-http middleware
	 */
	validateArgsGetHeader(req, res, next) {
		const isValidHash = validator.isHash(req.params.hash, "sha256");

		if (isValidHash) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				req.params.hash,
				"API : HeadersRestApi.validateArgsGetHeader() : Invalid hash",
			);
		}
	}
}

export default HeadersRestApi;

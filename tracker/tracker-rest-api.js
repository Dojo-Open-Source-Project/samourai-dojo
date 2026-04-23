/*!
 * tracker/tracker-rest-api.js
 * Copyright (c) 2016-2019, Samourai Wallet (CC BY-NC-ND 4.0 License).
 */

import validator from "validator";
import keysFile from "../keys/index.js";
import authMgr from "../lib/auth/authorizations-manager.js";
import network from "../lib/bitcoin/network.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";

const keys = keysFile[network.key];

/**
 * Tracker API endpoints
 */
class TrackerRestApi {
	/**
	 * Constructor
	 * @param {HttpServer} httpServer - HTTP server
	 * @param {Tracker} tracker - tracker
	 */
	constructor(httpServer, tracker) {
		this.httpServer = httpServer;
		this.tracker = tracker;

		// Establish routes. Proxy server strips /pushtx
		this.httpServer.app.get(
			`/${keys.prefixes.support}/rescan`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.getBlocksRescan.bind(this),
		);
	}

	/**
	 * Rescan a range of blocks
	 */
	async getBlocksRescan(req, res) {
		// Check req.arguments
		if (!req.query) return HttpServer.sendError(res, errors.body.INVDATA);

		if (!req.query.fromHeight || !validator.isInt(req.query.fromHeight))
			return HttpServer.sendError(res, errors.body.INVDATA);

		if (req.query.toHeight && !validator.isInt(req.query.toHeight))
			return HttpServer.sendError(res, errors.body.INVDATA);

		// Retrieve the req.arguments
		const fromHeight = Number.parseInt(req.query.fromHeight, 10);
		const toHeight = req.query.toHeight
			? Number.parseInt(req.query.toHeight, 10)
			: fromHeight;

		if (req.query.toHeight && toHeight < fromHeight)
			return HttpServer.sendError(res, errors.body.INVDATA);

		try {
			await this.tracker.blockchainProcessor.rescanBlocks(fromHeight, toHeight);
			const returnValue = {
				status: "Rescan complete",
				fromHeight: fromHeight,
				toHeight: toHeight,
			};
			HttpServer.sendRawData(res, JSON.stringify(returnValue, null, 2));
		} catch (error) {
			return HttpServer.sendError(res, error);
		}
	}
}

export default TrackerRestApi;

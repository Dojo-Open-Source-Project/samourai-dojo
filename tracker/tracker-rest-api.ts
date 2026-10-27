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
import type Tracker from "./tracker.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * Tracker API endpoints
 */
class TrackerRestApi {
	declare httpServer: HttpServer;
	declare tracker: Tracker;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer, tracker: Tracker) {
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
	async getBlocksRescan(c: HttpContext) {
		// Check req.arguments
		if (!c.req.query()) return HttpServer.sendError(c, errors.body.INVDATA);

		if (
			!c.req.query("fromHeight") ||
			!validator.isInt(c.req.query("fromHeight"))
		)
			return HttpServer.sendError(c, errors.body.INVDATA);

		if (c.req.query("toHeight") && !validator.isInt(c.req.query("toHeight")))
			return HttpServer.sendError(c, errors.body.INVDATA);

		// Retrieve the req.arguments
		const fromHeight = Number.parseInt(c.req.query("fromHeight"), 10);
		const toHeight = c.req.query("toHeight")
			? Number.parseInt(c.req.query("toHeight"), 10)
			: fromHeight;

		if (c.req.query("toHeight") && toHeight < fromHeight)
			return HttpServer.sendError(c, errors.body.INVDATA);

		try {
			await this.tracker.blockchainProcessor.rescanBlocks(fromHeight, toHeight);
			const returnValue = {
				status: "Rescan complete",
				fromHeight: fromHeight,
				toHeight: toHeight,
			};
			HttpServer.sendRawData(c, JSON.stringify(returnValue, null, 2));
		} catch (error) {
			return HttpServer.sendError(c, error);
		}
	}
}

export default TrackerRestApi;

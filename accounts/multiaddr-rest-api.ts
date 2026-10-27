/*!
 * accounts/multiaddr-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import authMgr from "../lib/auth/authorizations-manager.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import walletService from "../lib/wallet/wallet-service.js";
import apiHelper from "./api-helper.js";

const debugApi = process.argv.includes("api-debug");

/**
 * Multiaddr API endpoints
 * @deprecated
 */
class MultiaddrRestApi {
	[key: string]: unknown;
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.get(
			"/multiaddr",
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.getMultiaddr.bind(this),
		);

		this.httpServer.app.post(
			"/multiaddr",
			HttpServer.parseForm,
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.postMultiaddr.bind(this),
		);
	}

	/**
	 * Handle multiaddr GET request
	 */
	async getMultiaddr(c: HttpContext) {
		try {
			// Check request params
			if (!apiHelper.checkEntitiesParams(c.req.query()))
				return HttpServer.sendError(c, errors.multiaddr.NOACT);
			//return HttpServer.sendError(c, '')
			// Parse params
			const entities = apiHelper.parseEntitiesParams(c.req.query());

			if (
				entities.active.addrs.length === 1 ||
				entities.active.addrs.length === 2 ||
				entities.active.xpubs.length === 1
			)
				return HttpServer.sendError(c, "");

			const result = await walletService.getWalletInfo(
				entities.active,
				entities.legacy,
				entities.bip49,
				entities.bip84,
				entities.pubkey,
			);

			const returnValue = JSON.stringify(result, null, 2);
			HttpServer.sendRawData(c, returnValue);
		} catch (error) {
			HttpServer.sendError(c, error);
		} finally {
			if (debugApi) {
				const stringParameters = `${c.req.query("active") || ""} \
                     ${c.req.query("new") || ""} \
                     ${c.req.query("pubkey") || ""} \
                     ${c.req.query("bip49") || ""} \
                     ${c.req.query("bip84") || ""}`;

				Logger.info(`API : Completed GET /multiaddr ${stringParameters}`);
			}
		}
	}

	/**
	 * Handle multiaddr POST request
	 */
	async postMultiaddr(c: HttpContext) {
		try {
			// Check request params
			if (!apiHelper.checkEntitiesParams(c.get("body")))
				return HttpServer.sendError(c, errors.multiaddr.NOACT);

			// Parse params
			const entities = apiHelper.parseEntitiesParams(c.get("body"));

			const result = await walletService.getWalletInfo(
				entities.active,
				entities.legacy,
				entities.bip49,
				entities.bip84,
				entities.pubkey,
			);

			HttpServer.sendOkDataOnly(c, result);
		} catch (error) {
			HttpServer.sendError(c, error);
		} finally {
			if (debugApi) {
				const stringParameters = `${c.get("body").active || ""} \
                     ${c.get("body").new || ""} \
                     ${c.get("body").pubkey || ""} \
                     ${c.get("body").bip49 || ""} \
                     ${c.get("body").bip84 || ""}`;

				Logger.info(`API : Completed POST /multiaddr ${stringParameters}`);
			}
		}
	}
}

export default MultiaddrRestApi;

/*!
 * accounts/wallet-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import authMgr from "../lib/auth/authorizations-manager.js";
import hdaService from "../lib/bitcoin/hd-accounts-service.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import walletService from "../lib/wallet/wallet-service.js";
import apiHelper from "./api-helper.js";

const debugApi = process.argv.includes("api-debug");

/**
 * Wallet API endpoints
 */
class WalletRestApi {
	[key: string]: unknown;
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.get(
			"/wallet",
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.getWallet.bind(this),
		);

		this.httpServer.app.post(
			"/wallet",
			HttpServer.parseForm,
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.postWallet.bind(this),
		);
	}

	/**
	 * Handle wallet GET request
	 */
	async getWallet(c: HttpContext) {
		try {
			// Check request params
			if (!apiHelper.checkEntitiesParams(c.req.query()))
				return HttpServer.sendError(c, errors.multiaddr.NOACT);

			// Parse params
			const entities = apiHelper.parseEntitiesParams(c.req.query());

			if (c.req.query("importPostmixLikeTypeChange")) {
				await hdaService.importPostmixLikeTypeChange(entities.active.xpubs);
			}

			const result = await walletService.getFullWalletInfo(
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

				Logger.info(`API : Completed GET /wallet ${stringParameters}`);
			}
		}
	}

	/**
	 * Handle wallet POST request
	 */
	async postWallet(c: HttpContext) {
		try {
			// Check request params
			if (!apiHelper.checkEntitiesParams(c.get("body")))
				return HttpServer.sendError(c, errors.multiaddr.NOACT);

			// Parse params
			const entities = apiHelper.parseEntitiesParams(c.get("body"));

			if (c.get("body").importPostmixLikeTypeChange) {
				await hdaService.importPostmixLikeTypeChange(entities.active.xpubs);
			}

			const result = await walletService.getFullWalletInfo(
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

				Logger.info(`API : Completed POST /wallet ${stringParameters}`);
			}
		}
	}
}

export default WalletRestApi;

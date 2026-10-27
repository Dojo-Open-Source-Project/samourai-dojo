/*!
 * accounts/unspent-rest-api.js
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
 * Unspent API endpoints
 * @deprecated
 */
class UnspentRestApi {
	[key: string]: unknown;
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.get(
			"/unspent",
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.getUnspent.bind(this),
		);

		this.httpServer.app.post(
			"/unspent",
			HttpServer.parseForm,
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.postUnspent.bind(this),
		);
	}

	/**
	 * Handle unspent GET request
	 */
	async getUnspent(c: HttpContext) {
		// Check request params
		if (!apiHelper.checkEntitiesParams(c.req.query()))
			return HttpServer.sendError(c, errors.multiaddr.NOACT);

		// Parse params
		const entities = apiHelper.parseEntitiesParams(c.req.query());

		try {
			const result = await walletService.getWalletUtxos(
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

				Logger.info(`API : Completed GET /unspent ${stringParameters}`);
			}
		}
	}

	/**
	 * Handle unspent POST request
	 */
	async postUnspent(c: HttpContext) {
		// Check request params
		if (!apiHelper.checkEntitiesParams(c.get("body")))
			return HttpServer.sendError(c, errors.multiaddr.NOACT);

		// Parse params
		const entities = apiHelper.parseEntitiesParams(c.get("body"));

		try {
			const result = await walletService.getWalletUtxos(
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

				Logger.info(`API : Completed POST /unspent ${stringParameters}`);
			}
		}
	}
}

export default UnspentRestApi;

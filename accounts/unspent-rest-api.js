/*!
 * accounts/unspent-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { urlencoded } from "milliparsec";
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
	/**
	 * Constructor
	 * @param {HttpServer} httpServer - HTTP server
	 */
	constructor(httpServer) {
		this.httpServer = httpServer;

		// Establish routes
		const urlencodedParser = urlencoded();

		this.httpServer.app.get(
			"/unspent",
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.getUnspent.bind(this),
		);

		this.httpServer.app.post(
			"/unspent",
			urlencodedParser,
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.postUnspent.bind(this),
		);
	}

	/**
	 * Handle unspent GET request
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async getUnspent(req, res) {
		// Check request params
		if (!apiHelper.checkEntitiesParams(req.query))
			return HttpServer.sendError(res, errors.multiaddr.NOACT);

		// Parse params
		const entities = apiHelper.parseEntitiesParams(req.query);

		try {
			const result = await walletService.getWalletUtxos(
				entities.active,
				entities.legacy,
				entities.bip49,
				entities.bip84,
				entities.pubkey,
			);

			const returnValue = JSON.stringify(result, null, 2);
			HttpServer.sendRawData(res, returnValue);
		} catch (error) {
			HttpServer.sendError(res, error);
		} finally {
			if (debugApi) {
				const stringParameters = `${req.query.active || ""} \
                     ${req.query.new || ""} \
                     ${req.query.pubkey || ""} \
                     ${req.query.bip49 || ""} \
                     ${req.query.bip84 || ""}`;

				Logger.info(`API : Completed GET /unspent ${stringParameters}`);
			}
		}
	}

	/**
	 * Handle unspent POST request
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async postUnspent(req, res) {
		// Check request params
		if (!apiHelper.checkEntitiesParams(req.body))
			return HttpServer.sendError(res, errors.multiaddr.NOACT);

		// Parse params
		const entities = apiHelper.parseEntitiesParams(req.body);

		try {
			const result = await walletService.getWalletUtxos(
				entities.active,
				entities.legacy,
				entities.bip49,
				entities.bip84,
				entities.pubkey,
			);

			HttpServer.sendOkDataOnly(res, result);
		} catch (error) {
			HttpServer.sendError(res, error);
		} finally {
			if (debugApi) {
				const stringParameters = `${req.body.active || ""} \
                     ${req.body.new || ""} \
                     ${req.body.pubkey || ""} \
                     ${req.body.bip49 || ""} \
                     ${req.body.bip84 || ""}`;

				Logger.info(`API : Completed POST /unspent ${stringParameters}`);
			}
		}
	}
}

export default UnspentRestApi;

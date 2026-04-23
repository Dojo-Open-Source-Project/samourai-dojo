/*!
 * accounts/multiaddr-rest-api.js
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
 * Multiaddr API endpoints
 * @deprecated
 */
class MultiaddrRestApi {
	/**
	 * Constructor
	 * @param {HttpServer} httpServer - HTTP server
	 */
	constructor(httpServer) {
		this.httpServer = httpServer;

		// Establish routes
		const urlencodedParser = urlencoded();

		this.httpServer.app.get(
			"/multiaddr",
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.getMultiaddr.bind(this),
			HttpServer.sendAuthError,
		);

		this.httpServer.app.post(
			"/multiaddr",
			urlencodedParser,
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.postMultiaddr.bind(this),
			HttpServer.sendAuthError,
		);
	}

	/**
	 * Handle multiaddr GET request
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async getMultiaddr(req, res) {
		try {
			// Check request params
			if (!apiHelper.checkEntitiesParams(req.query))
				return HttpServer.sendError(res, errors.multiaddr.NOACT);
			//return HttpServer.sendError(res, '')
			// Parse params
			const entities = apiHelper.parseEntitiesParams(req.query);

			if (
				entities.active.addrs.length === 1 ||
				entities.active.addrs.length === 2 ||
				entities.active.xpubs.length === 1
			)
				return HttpServer.sendError(res, "");

			const result = await walletService.getWalletInfo(
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

				Logger.info(`API : Completed GET /multiaddr ${stringParameters}`);
			}
		}
	}

	/**
	 * Handle multiaddr POST request
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async postMultiaddr(req, res) {
		try {
			// Check request params
			if (!apiHelper.checkEntitiesParams(req.body))
				return HttpServer.sendError(res, errors.multiaddr.NOACT);

			// Parse params
			const entities = apiHelper.parseEntitiesParams(req.body);

			const result = await walletService.getWalletInfo(
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

				Logger.info(`API : Completed POST /multiaddr ${stringParameters}`);
			}
		}
	}
}

export default MultiaddrRestApi;

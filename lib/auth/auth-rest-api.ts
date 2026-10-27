/*!
 * lib/auth/auth-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import crypto from "node:crypto";
import { Auth47Verifier } from "@dojo-tools/auth47";
import { json, urlencoded } from "milliparsec";
import { RPC } from "soroban-client-nodejs";
import * as ecc from "tiny-secp256k1";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import { coordinator } from "../coordination/client.js";
import HttpServer from "../http-server/http-server.js";
import Logger from "../logger.js";
import authentMgr from "./authentication-manager.js";
import authorzMgr from "./authorizations-manager.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */

const adminPaymentCodes =
	keys.auth.strategies?.auth47?.paymentCodes?.filter(Boolean) ?? []; // filter out falsy values
const auth47Enabled = adminPaymentCodes.length > 0;
const AUTH47_CALLBACK_URI = "/auth/auth47/authenticate";
const AUTH47_SOROBAN_CALLBACK_URI = "/auth/auth47/authenticate/soroban";

const auth47Hostname = keys.auth.strategies?.auth47?.hostname;
const AUTH47_CALLBACK_URL =
	auth47Enabled && auth47Hostname
		? new URL(
				`${auth47Hostname}${network.key === "testnet" ? "/test/v2" : "/v2"}${AUTH47_CALLBACK_URI}`,
			).toString()
		: null;

const verifier = AUTH47_CALLBACK_URL
	? new Auth47Verifier(ecc, AUTH47_CALLBACK_URL)
	: null;

const verifierSoroban = new Auth47Verifier(
	ecc,
	`${keys.auth.strategies?.auth47?.hostname}${network.key === "testnet" ? "/test/v2" : "/v2"}${AUTH47_SOROBAN_CALLBACK_URI}`,
);

/**
 * Auth API endpoints
 */
class AuthRestApi {
	declare httpServer: HttpServer;
	declare sorobanRpc: RPC | null;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		const urlencodedParser = urlencoded();
		const jsonParser = json();

		this.httpServer.app.post(
			"/auth/login",
			urlencodedParser,
			authentMgr.authenticate,
			authorzMgr.generateAuthorizations.bind(authorzMgr),
			this.login,
		);

		this.httpServer.app.post(
			"/auth/logout",
			urlencodedParser,
			authorzMgr.revokeAuthorizations.bind(authorzMgr),
			this.logout,
		);

		this.httpServer.app.post(
			"/auth/refresh",
			urlencodedParser,
			authorzMgr.refreshAuthorizations.bind(authorzMgr),
			this.refresh,
		);

		this.httpServer.app.get("/auth/auth47/uri", this.getAuth47Uri.bind(this));

		this.httpServer.app.post(
			AUTH47_SOROBAN_CALLBACK_URI,
			jsonParser,
			this.sorobanAuthenticateAuth47.bind(this),
		);

		this.httpServer.app.post(
			AUTH47_CALLBACK_URI,
			jsonParser,
			this.authenticateAuth47.bind(this),
		);

		this.httpServer.app.get(
			"/auth/auth47/status/:nonce",
			this.checkAuth47Status.bind(this),
		);

		this.initSorobanRpc();
	}

	/**
	 * Initialize a wrapper to the Soroban RPC API is configuration is set
	 */
	initSorobanRpc(): void {
		this.sorobanRpc = null;
		const sorobanUrl = keys.soroban.rpc;
		if (sorobanUrl != null) {
			const socks5ProxyUrl = sorobanUrl.includes(".onion")
				? keys.soroban.socks5Proxy
				: null;
			this.sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl);
		}
	}

	/**
	 * Get Auth47 URI
	 */
	async getAuth47Uri(_req: HttpRequestLike, res: HttpResponseLike) {
		if (!auth47Enabled || !verifier) {
			HttpServer.sendError(res, "Auth47 not enabled");
			return;
		}
		try {
			const nonce = crypto.randomBytes(12).toString("hex");
			const expiresAt = await coordinator.request("nonce.create", { nonce });
			const uri = verifier.generateURI({ nonce, expires: new Date(expiresAt) });
			const paymentCode = adminPaymentCodes[0] ?? null;
			HttpServer.sendOkData(res, { nonce, uri, paymentCode });
		} catch (error) {
			HttpServer.sendError(res, error, 503);
		}
	}

	/**
	 * Authenticate Auth47 request
	 */
	async authenticateAuth47(req: HttpRequestLike, res: HttpResponseLike) {
		if (!auth47Enabled || !verifier) {
			HttpServer.sendError(res, "Auth47 not enabled");
			return;
		}
		try {
			if (!req.body.nym || !adminPaymentCodes.includes(req.body.nym)) {
				HttpServer.sendAuthError(res, "invalid payment code");
				return;
			}
			const verifyResult = verifier.verifyProof(req.body, network.key);
			if (verifyResult.result !== "ok") {
				HttpServer.sendAuthError(res, verifyResult.error);
				return;
			}
			const challenge = new URL(verifyResult.data.challenge);
			const resources = challenge.searchParams.getAll("r");
			if (resources.length !== 1 || resources[0] !== AUTH47_CALLBACK_URL) {
				HttpServer.sendAuthError(res, "invalid resource");
				return;
			}
			const approved = await coordinator.request("nonce.approve", {
				nonce: challenge.hostname,
			});
			if (approved) HttpServer.sendOk(res);
			else HttpServer.sendAuthError(res, "invalid nonce");
		} catch (error) {
			HttpServer.sendError(res, error, 503);
		}
	}

	/**
	 * Authenticate to Soroban with Auth47
	 */
	async sorobanAuthenticateAuth47(req: HttpRequestLike, res: HttpResponseLike) {
		if (!this.sorobanRpc) {
			HttpServer.sendAuthError(
				res,
				"soroban network is unreachable from this dojo",
			);
			return;
		}

		if (!verifierSoroban) {
			HttpServer.sendError(res, "Auth47 not enabled");
			return;
		}

		const verifyResult = verifierSoroban.verifyProof(req.body, network.key);
		if (verifyResult.result !== "ok") {
			HttpServer.sendAuthError(res, verifyResult.error);
			return;
		}

		const resources = new URL(verifyResult.data.challenge).searchParams.getAll(
			"r",
		);
		if (resources.length !== 1 || resources[0] !== "srbn") {
			HttpServer.sendAuthError(res, "invalid resource");
			return;
		}

		const entry = JSON.stringify(req.body);
		const success = await this.sorobanRpc.directoryAdd(
			keys.soroban.keyAuth47,
			entry,
			"short",
		);
		if (success) {
			Logger.info("Successful authentication to Soroban with auth47");
			HttpServer.sendOk(res);
		} else {
			HttpServer.sendAuthError(
				res,
				"failed to push proof over the Soroban network",
			);
		}
	}

	/**
	 * Check status of current Auth47 authentication request
	 */
	async checkAuth47Status(req: HttpRequestLike, res: HttpResponseLike) {
		if (!auth47Enabled) {
			HttpServer.sendError(res, "Auth47 not enabled");
			return;
		}
		try {
			const status = await coordinator.request("nonce.consume", {
				nonce: req.params.nonce,
			});
			if (status === "missing") {
				HttpServer.sendAuthError(res, "auth request expired");
				return;
			}
			if (status === "pending") {
				HttpServer.sendRawData(res, {});
				return;
			}
			Logger.info("Auth : Successful authentication with a payment code");
			const accessToken = authorzMgr._generateAccessToken({
				profile: authorzMgr.TOKEN_PROFILE_ADMIN,
			});
			const refreshToken = authorzMgr._generateRefreshToken({
				profile: authorzMgr.TOKEN_PROFILE_ADMIN,
			});
			HttpServer.sendRawData(
				res,
				JSON.stringify({
					authorizations: {
						access_token: accessToken,
						refresh_token: refreshToken,
					},
				}),
			);
		} catch (error) {
			HttpServer.sendError(res, error, 503);
		}
	}

	/**
	 * Login
	 */
	login(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			const result = { authorizations: req.authorizations };
			const returnValue = JSON.stringify(result, null, 2);
			HttpServer.sendRawData(res, returnValue);
		} catch (error) {
			HttpServer.sendError(res, error);
		}
	}

	/**
	 * Refresh
	 */
	refresh(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			const result = { authorizations: req.authorizations };
			const returnValue = JSON.stringify(result, null, 2);
			HttpServer.sendRawData(res, returnValue);
		} catch (error) {
			HttpServer.sendError(res, error);
		}
	}

	/**
	 * Logout
	 */
	logout(_req: HttpRequestLike, res: HttpResponseLike) {
		HttpServer.sendOk(res);
	}
}

export default AuthRestApi;

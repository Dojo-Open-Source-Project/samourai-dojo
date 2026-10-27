/*!
 * lib/auth/auth-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { Auth47Verifier } from "@dojo-tools/auth47";
import { RPC } from "soroban-client-nodejs";
import * as ecc from "tiny-secp256k1";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import HttpServer from "../http-server/http-server.js";
import Logger from "../logger.js";
import { Auth47Nonces } from "./auth47-nonces.js";
import authentMgr from "./authentication-manager.js";
import authorzMgr from "./authorizations-manager.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

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
	private readonly nonces = new Auth47Nonces();
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.post(
			"/auth/login",
			HttpServer.parseForm,
			authentMgr.authenticate,
			authorzMgr.generateAuthorizations.bind(authorzMgr),
			this.login,
		);

		this.httpServer.app.post(
			"/auth/logout",
			HttpServer.parseForm,
			authorzMgr.revokeAuthorizations.bind(authorzMgr),
			this.logout,
		);

		this.httpServer.app.post(
			"/auth/refresh",
			HttpServer.parseForm,
			authorzMgr.refreshAuthorizations.bind(authorzMgr),
			this.refresh,
		);

		this.httpServer.app.get("/auth/auth47/uri", this.getAuth47Uri.bind(this));

		this.httpServer.app.post(
			AUTH47_SOROBAN_CALLBACK_URI,
			HttpServer.parseJson,
			this.sorobanAuthenticateAuth47.bind(this),
		);

		this.httpServer.app.post(
			AUTH47_CALLBACK_URI,
			HttpServer.parseJson,
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
	async getAuth47Uri(c: HttpContext) {
		if (!auth47Enabled || !verifier) {
			HttpServer.sendError(c, "Auth47 not enabled");
			return;
		}
		try {
			const { nonce, expiresAt } = this.nonces.create();
			const uri = verifier.generateURI({ nonce, expires: new Date(expiresAt) });
			const paymentCode = adminPaymentCodes[0] ?? null;
			HttpServer.sendOkData(c, { nonce, uri, paymentCode });
		} catch (error) {
			HttpServer.sendError(c, error, 503);
		}
	}

	/**
	 * Authenticate Auth47 request
	 */
	async authenticateAuth47(c: HttpContext) {
		if (!auth47Enabled || !verifier) {
			HttpServer.sendError(c, "Auth47 not enabled");
			return;
		}
		try {
			if (
				!c.get("body").nym ||
				!adminPaymentCodes.includes(c.get("body").nym as string)
			) {
				HttpServer.sendAuthError(c, "invalid payment code");
				return;
			}
			const verifyResult = verifier.verifyProof(c.get("body"), network.key);
			if (verifyResult.result !== "ok") {
				HttpServer.sendAuthError(c, verifyResult.error);
				return;
			}
			const challenge = new URL(verifyResult.data.challenge);
			const resources = challenge.searchParams.getAll("r");
			if (resources.length !== 1 || resources[0] !== AUTH47_CALLBACK_URL) {
				HttpServer.sendAuthError(c, "invalid resource");
				return;
			}
			const approved = this.nonces.approve(challenge.hostname);
			if (approved) HttpServer.sendOk(c);
			else HttpServer.sendAuthError(c, "invalid nonce");
		} catch (error) {
			HttpServer.sendError(c, error, 503);
		}
	}

	/**
	 * Authenticate to Soroban with Auth47
	 */
	async sorobanAuthenticateAuth47(c: HttpContext) {
		if (!this.sorobanRpc) {
			HttpServer.sendAuthError(
				c,
				"soroban network is unreachable from this dojo",
			);
			return;
		}

		if (!verifierSoroban) {
			HttpServer.sendError(c, "Auth47 not enabled");
			return;
		}

		const verifyResult = verifierSoroban.verifyProof(
			c.get("body"),
			network.key,
		);
		if (verifyResult.result !== "ok") {
			HttpServer.sendAuthError(c, verifyResult.error);
			return;
		}

		const resources = new URL(verifyResult.data.challenge).searchParams.getAll(
			"r",
		);
		if (resources.length !== 1 || resources[0] !== "srbn") {
			HttpServer.sendAuthError(c, "invalid resource");
			return;
		}

		const entry = JSON.stringify(c.get("body"));
		const success = await this.sorobanRpc.directoryAdd(
			keys.soroban.keyAuth47,
			entry,
			"short",
		);
		if (success) {
			Logger.info("Successful authentication to Soroban with auth47");
			HttpServer.sendOk(c);
		} else {
			HttpServer.sendAuthError(
				c,
				"failed to push proof over the Soroban network",
			);
		}
	}

	/**
	 * Check status of current Auth47 authentication request
	 */
	async checkAuth47Status(c: HttpContext) {
		if (!auth47Enabled) {
			HttpServer.sendError(c, "Auth47 not enabled");
			return;
		}
		try {
			const status = this.nonces.consume(c.req.param("nonce"));
			if (status === "missing") {
				HttpServer.sendAuthError(c, "auth request expired");
				return;
			}
			if (status === "pending") {
				HttpServer.sendRawData(c, {});
				return;
			}
			Logger.info("Auth : Successful authentication with a payment code");
			const accessToken = await authorzMgr._generateAccessToken({
				profile: authorzMgr.TOKEN_PROFILE_ADMIN,
			});
			const refreshToken = await authorzMgr._generateRefreshToken({
				profile: authorzMgr.TOKEN_PROFILE_ADMIN,
			});
			HttpServer.sendRawData(
				c,
				JSON.stringify({
					authorizations: {
						access_token: accessToken,
						refresh_token: refreshToken,
					},
				}),
			);
		} catch (error) {
			HttpServer.sendError(c, error, 503);
		}
	}

	/**
	 * Login
	 */
	async login(c: HttpContext) {
		try {
			const result = { authorizations: c.get("authorizations") };
			const returnValue = JSON.stringify(result, null, 2);
			HttpServer.sendRawData(c, returnValue);
		} catch (error) {
			HttpServer.sendError(c, error);
		}
	}

	/**
	 * Refresh
	 */
	async refresh(c: HttpContext) {
		try {
			const result = { authorizations: c.get("authorizations") };
			const returnValue = JSON.stringify(result, null, 2);
			HttpServer.sendRawData(c, returnValue);
		} catch (error) {
			HttpServer.sendError(c, error);
		}
	}

	/**
	 * Logout
	 */
	async logout(c: HttpContext) {
		HttpServer.sendOk(c);
	}
}

export default AuthRestApi;

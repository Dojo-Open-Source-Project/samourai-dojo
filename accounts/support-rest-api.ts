/*!
 * accounts/support-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import crypto from "node:crypto";
import validator from "validator";
import keysFile from "../keys/index.js";
import authMgr from "../lib/auth/authorizations-manager.js";
import addrService from "../lib/bitcoin/addresses-service.js";
import hdaService from "../lib/bitcoin/hd-accounts-service.js";
import network from "../lib/bitcoin/network.js";
import db from "../lib/db/mysql-db-wrapper.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import AddressInfo from "../lib/wallet/address-info.js";
import HdAccountInfo from "../lib/wallet/hd-account-info.js";
import apiHelper from "./api-helper.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;
const debugApi = process.argv.includes("api-debug");

/**
 * Support API endpoints
 */
class SupportRestApi {
	[key: string]: unknown;
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		this.httpServer.app.get(
			`/${keys.prefixes.support}/address/:addr/info`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.validateAddress.bind(this),
			this.getAddressInfo.bind(this),
		);

		this.httpServer.app.get(
			`/${keys.prefixes.support}/address/:addr/rescan`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.validateAddress.bind(this),
			this.getAddressRescan.bind(this),
		);

		this.httpServer.app.get(
			`/${keys.prefixes.support}/xpub/:xpub/info`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.validateArgsGetXpubInfo.bind(this),
			this.getXpubInfo.bind(this),
		);

		this.httpServer.app.get(
			`/${keys.prefixes.support}/xpub/:xpub/rescan`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.validateArgsGetXpubRescan.bind(this),
			this.getXpubRescan.bind(this),
		);

		this.httpServer.app.get(
			`/${keys.prefixes.support}/xpub/:xpub/delete`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.validateArgsGetXpubDelete.bind(this),
			this.getXpubDelete.bind(this),
		);

		/**
		 * @deprecated
		 */
		this.httpServer.app.get(
			`/${keys.prefixes.support}/pairing/explorer`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.getPairingExplorer.bind(this),
		);

		this.httpServer.app.get(
			`/${keys.prefixes.support}/pairing`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.getPairing.bind(this),
		);

		this.httpServer.app.get(
			`/${keys.prefixes.support}/services`,
			authMgr.checkAuthentication.bind(authMgr),
			this.getServices.bind(this),
		);

		/* API keys */
		this.httpServer.app.get(
			`/${keys.prefixes.support}/apikeys`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.getApiKeys.bind(this),
		);

		this.httpServer.app.post(
			`/${keys.prefixes.support}/apikey`,
			HttpServer.parseJson,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.createApiKey.bind(this),
		);

		this.httpServer.app.patch(
			`/${keys.prefixes.support}/apikey/:apikey`,
			HttpServer.parseJson,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.updateApiKey.bind(this),
		);

		this.httpServer.app.delete(
			`/${keys.prefixes.support}/apikey/:apikey`,
			authMgr.checkHasAdminProfile.bind(authMgr),
			this.deleteApiKey.bind(this),
		);
	}

	/**
	 * Retrieve information for a given address
	 */
	async getAddressInfo(c: HttpContext) {
		try {
			// Parse the entities passed as url params
			const entities = apiHelper.parseEntities(c.req.param("addr")).addrs;
			if (entities.length === 0)
				return HttpServer.sendError(c, errors.address.INVALID);

			const address = entities[0];
			const info = new AddressInfo(address);
			await info.loadInfoExtended();
			await info.loadTransactions();
			await info.loadUtxos();
			const returnValue = this._formatAddressInfoResult(info);
			HttpServer.sendRawData(c, returnValue);
		} catch {
			HttpServer.sendError(c, errors.generic.GEN);
		} finally {
			debugApi &&
				Logger.info(
					`API : Completed GET /support/address/${c.req.param("addr")}/info`,
				);
		}
	}

	/**
	 * Format response to be returned
	 * for calls to getAddressInfo
	 */
	_formatAddressInfoResult(info: AddressInfo) {
		const result = info.toPojoExtended();
		return JSON.stringify(result, null, 2);
	}

	/**
	 * Rescan the blockchain for a given address
	 */
	async getAddressRescan(c: HttpContext) {
		try {
			// Parse the entities passed as url params
			const entities = apiHelper.parseEntities(c.req.param("addr")).addrs;
			if (entities.length === 0)
				return HttpServer.sendError(c, errors.address.INVALID);

			const address = entities[0];

			const returnValue = {
				status: "Rescan complete",
			};

			await addrService.rescan(address);
			HttpServer.sendRawData(c, JSON.stringify(returnValue, null, 2));
		} catch {
			HttpServer.sendError(c, errors.generic.GEN);
		} finally {
			debugApi &&
				Logger.info(
					`API : Completed GET /support/address/${c.req.param("addr")}/rescan`,
				);
		}
	}

	/**
	 * Retrieve information for a given hd account
	 */
	async getXpubInfo(c: HttpContext) {
		try {
			// Parse the entities passed as url params
			const entities = apiHelper.parseEntities(c.req.param("xpub")).xpubs;
			if (entities.length === 0)
				return HttpServer.sendError(c, errors.xpub.INVALID);

			const xpub = entities[0];
			let info: HdAccountInfo;

			try {
				info = new HdAccountInfo(xpub);
				await info.loadInfo();
				const returnValue = this._formatXpubInfoResult(info);
				HttpServer.sendRawData(c, returnValue);
			} catch (error) {
				if (error === errors.db.ERROR_NO_HD_ACCOUNT) {
					const returnValue = this._formatXpubInfoResult(info);
					HttpServer.sendRawData(c, returnValue);
				} else {
					HttpServer.sendError(c, errors.generic.GEN);
				}
			}
		} catch {
			HttpServer.sendError(c, errors.generic.GEN);
		} finally {
			debugApi &&
				Logger.info(
					`API : Completed GET /support/xpub/${c.req.param("xpub")}/info`,
				);
		}
	}

	/**
	 * Format response to be returned
	 * for calls to getXpubInfo
	 */
	_formatXpubInfoResult(info: HdAccountInfo) {
		const result = info.toPojoExtended();
		return JSON.stringify(result, null, 2);
	}

	/**
	 * Rescan the blockchain for a given address
	 */
	async getXpubRescan(c: HttpContext) {
		try {
			// Parse the entities passed as url params
			const entities = apiHelper.parseEntities(c.req.param("xpub")).xpubs;
			if (entities.length === 0)
				return HttpServer.sendError(c, errors.xpub.INVALID);

			const xpub = entities[0];

			const returnValue = {
				status: "Rescan complete",
			};

			const gapLimit =
				c.req.query("gap") == null
					? 0
					: Number.parseInt(c.req.query("gap"), 10);
			const startIndex =
				c.req.query("startidx") == null
					? 0
					: Number.parseInt(c.req.query("startidx"), 10);

			try {
				await hdaService.rescan(xpub, gapLimit, startIndex);
				HttpServer.sendRawData(c, JSON.stringify(returnValue, null, 2));
			} catch (error) {
				if (error === errors.db.ERROR_NO_HD_ACCOUNT) {
					returnValue.status = "Error: Not tracking xpub";
					HttpServer.sendRawData(c, JSON.stringify(returnValue, null, 2));
				} else if (error === errors.xpub.OVERLAP) {
					returnValue.status = "Error: Rescan in progress";
					HttpServer.sendRawData(c, JSON.stringify(returnValue, null, 2));
				} else {
					returnValue.status = "Rescan Error";
					Logger.error(
						error,
						"API : SupportRestApi.getXpubRescan() : Support rescan error",
					);
					HttpServer.sendError(c, JSON.stringify(returnValue, null, 2));
				}
			}
		} catch {
			HttpServer.sendError(c, errors.generic.GEN);
		} finally {
			debugApi &&
				Logger.info(
					`API : Completed GET /support/xpub/${c.req.param("xpub")}/rescan`,
				);
		}
	}

	/**
	 * Delete all data related to a hd account
	 */
	async getXpubDelete(c: HttpContext) {
		try {
			// Parse the entities passed as url params
			const entities = apiHelper.parseEntities(c.req.param("xpub")).xpubs;
			if (entities.length === 0)
				return HttpServer.sendError(c, errors.xpub.INVALID);

			const xpub = entities[0];

			try {
				await hdaService.deleteHdAccount(xpub);
				HttpServer.sendOk(c);
			} catch (error) {
				HttpServer.sendError(c, error);
			}
		} catch {
			HttpServer.sendError(c, errors.generic.GEN);
		} finally {
			debugApi &&
				Logger.info(
					`API : Completed GET /support/xpub/${c.req.param("xpub")}/delete`,
				);
		}
	}

	/**
	 * Get pairing info
	 */
	async getPairing(c: HttpContext) {
		try {
			const returnValue = {
				pairing: {
					type: "dojo.api",
					version: keys.dojoVersion,
					apikey: keys.auth.strategies.localApiKey.apiKeys[0],
				},
				explorer: {
					type: `explorer.${keys.explorer.active}`,
					url: keys.explorer.uri,
				},
			};
			HttpServer.sendRawData(c, JSON.stringify(returnValue, null, 2));
		} catch (error) {
			const returnValue = {
				status: "error",
			};
			Logger.error(
				error,
				"API : SupportRestApi.getPairing() : Support pairing error",
			);
			HttpServer.sendError(c, JSON.stringify(returnValue, null, 2));
		} finally {
			debugApi && Logger.info("API : Completed GET /pairing");
		}
	}

	/**
	 * Get pairing info for the local block explorer
	 * @deprecated
	 */
	async getPairingExplorer(c: HttpContext) {
		try {
			const returnValue = {
				pairing: {
					type: `explorer.${keys.explorer.active}`,
					url: keys.explorer.uri,
				},
			};
			HttpServer.sendRawData(c, JSON.stringify(returnValue, null, 2));
		} catch (error) {
			const returnValue = {
				status: "error",
			};
			Logger.error(
				error,
				"API : SupportRestApi.getPairingExplorer() : Support pairing error",
			);
			HttpServer.sendError(c, JSON.stringify(returnValue, null, 2));
		} finally {
			debugApi && Logger.info("API : Completed GET /pairing/explorer");
		}
	}

	/**
	 * Get pairing info for miscellaneous services provided by the dojo
	 */
	async getServices(c: HttpContext) {
		try {
			const returnValue: {
				services: Array<{
					type: string;
					kind?: string | null;
					url?: string | null;
					keyAnnounce?: string;
					keyAuth47?: string;
				}>;
			} = { services: [] };
			if (keys.explorer.active !== null) {
				returnValue.services.push({
					type: "explorer",
					kind: keys.explorer.active,
					url: keys.explorer.uri,
				});
			}
			if (
				keys.indexer.active === "local_indexer" &&
				keys.indexer.localIndexer.externalUri !== null
			) {
				returnValue.services.push({
					type: "indexer",
					kind: keys.indexer.localIndexer.type,
					url: keys.indexer.localIndexer.externalUri,
				});
			}
			if (keys.soroban.externalRpc !== null) {
				returnValue.services.push({
					type: "soroban",
					kind: "rpc",
					url: keys.soroban.externalRpc,
					keyAnnounce: keys.soroban.keyAnnounce,
					keyAuth47: keys.soroban.keyAuth47,
				});
			}
			HttpServer.sendOkDataOnly(c, returnValue);
		} catch (error) {
			const returnValue = {
				status: "error",
			};
			Logger.error(error, "API : SupportRestApi.getServices() : Error");
			HttpServer.sendError(c, JSON.stringify(returnValue, null, 2));
		} finally {
			debugApi && Logger.info("API : Completed GET /services");
		}
	}

	/**
	 * Get API keys
	 */
	async getApiKeys(c: HttpContext) {
		const tokens = await db.getApiKeys();

		HttpServer.sendOkDataOnly(c, tokens);
	}

	/**
	 * Create API key
	 */
	async createApiKey(c: HttpContext) {
		try {
			const label = c.get("body").label;
			const expiresAt = c.get("body").expiresAt as string | number;

			if (
				typeof label !== "string" ||
				label.trim().length === 0 ||
				label.trim().length > 30
			)
				throw "Invalid label";
			if (!expiresAt || Number.isNaN(Date.parse(String(expiresAt))))
				throw "Invalid expiration date";

			const apikey = crypto.randomBytes(16).toString("hex");

			await db.createApiKey(label.trim(), apikey, new Date(expiresAt));

			HttpServer.sendOk(c);
		} catch (error) {
			HttpServer.sendError(c, error);
		}
	}

	/**
	 * Update API key
	 */
	async updateApiKey(c: HttpContext) {
		try {
			const apikey = c.req.param("apikey");
			const label = c.get("body").label;
			const expiresAt = c.get("body").expiresAt as string | number;
			const active = c.get("body").active;

			if (!apikey) throw "Invalid API key";
			if (
				typeof label !== "string" ||
				label.trim().length === 0 ||
				label.trim().length > 30
			)
				throw "Invalid label";
			if (!expiresAt || Number.isNaN(Date.parse(String(expiresAt))))
				throw "Invalid expiration date";
			if (active === undefined) throw "Invalid active status";

			const apikeyID = await db.getApiKeyID(apikey);

			if (!apikeyID) throw "API key not found";

			await db.updateApiKey(
				apikeyID,
				label.trim(),
				active as boolean,
				new Date(expiresAt),
			);

			HttpServer.sendOk(c);
		} catch (error) {
			HttpServer.sendError(c, error);
		}
	}

	/**
	 * Delete API key
	 */
	async deleteApiKey(c: HttpContext) {
		try {
			const apikey = c.req.param("apikey");

			if (!apikey) throw "Invalid API key";

			await db.deleteApiKey(apikey);

			HttpServer.sendOk(c);
		} catch (error) {
			HttpServer.sendError(c, error);
		}
	}

	/**
	 * Validate arguments related to GET xpub info requests
	 */
	async validateArgsGetXpubInfo(c: HttpContext, next: HttpNext) {
		const isValidXpub = validator.isAlphanumeric(c.req.param("xpub"));

		if (isValidXpub) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				null,
				`API : SupportRestApi.validateArgsGetXpubInfo() : Invalid xpub ${c.req.param("xpub")}`,
			);
		}
	}

	/**
	 * Validate arguments related to GET xpub rescan requests
	 */
	async validateArgsGetXpubRescan(c: HttpContext, next: HttpNext) {
		const isValidXpub = validator.isAlphanumeric(c.req.param("xpub"));
		const isValidGap =
			!c.req.query("gap") || validator.isInt(c.req.query("gap"));

		if (isValidXpub && isValidGap) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				null,
				"API : SupportRestApi.validateArgsGetXpubRescan() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate arguments related to GET xpub delete requests
	 */
	async validateArgsGetXpubDelete(c: HttpContext, next: HttpNext) {
		const isValidXpub = validator.isAlphanumeric(c.req.param("xpub"));

		if (isValidXpub) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				null,
				`API : SupportRestApi.validateArgsGetXpubDelete() : Invalid xpub ${c.req.param("xpub")}`,
			);
		}
	}

	/**
	 * Validate arguments related to addresses requests
	 */
	async validateAddress(c: HttpContext, next: HttpNext) {
		const isValidAddress = validator.isAlphanumeric(c.req.param("addr"));

		if (isValidAddress) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				null,
				`API : SupportRestApi.validateAddress() : Invalid address ${c.req.param("addr")}`,
			);
		}
	}
}

export default SupportRestApi;

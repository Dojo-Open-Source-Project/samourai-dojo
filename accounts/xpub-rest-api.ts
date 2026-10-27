/*!
 * accounts/xpub-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import validator from "validator";
import authMgr from "../lib/auth/authorizations-manager.js";
import hdaHelper from "../lib/bitcoin/hd-accounts-helper.js";
import hdaService from "../lib/bitcoin/hd-accounts-service.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import remoteImporter from "../lib/remote-importer/remote-importer.js";
import HdAccountInfo from "../lib/wallet/hd-account-info.js";

const debugApi = process.argv.includes("api-debug");

interface XlatHdAccountResult {
	xpub: string;
	scheme: number;
}

interface ImportStatusResponse {
	import_in_progress: boolean;
	status?: string;
	hits?: number;
}

const stringField = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

/**
 * XPub API endpoints
 */
class XPubRestApi {
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.post(
			"/xpub",
			HttpServer.parseForm,
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsPostXpub.bind(this),
			this.postXpub.bind(this),
		);

		this.httpServer.app.get(
			"/xpub/:xpub/import/status",
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsGetXpub.bind(this),
			this.getXpubImportStatus.bind(this),
		);

		this.httpServer.app.get(
			"/xpub/:xpub",
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsGetXpub.bind(this),
			this.getXpub.bind(this),
		);

		this.httpServer.app.post(
			"/xpub/:xpub/lock",
			HttpServer.parseForm,
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsPostLockXpub.bind(this),
			this.postLockXpub.bind(this),
		);

		this.httpServer.app.delete(
			"/xpub/:xpub",
			HttpServer.parseForm,
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsDeleteXpub.bind(this),
			this.deleteXpub.bind(this),
		);
	}

	/**
	 * Handle xPub POST request
	 */
	async postXpub(c: HttpContext) {
		try {
			let xpub: string;

			// Check request arguments
			if (!c.get("body")) return HttpServer.sendError(c, errors.body.NODATA);

			if (!c.get("body").xpub)
				return HttpServer.sendError(c, errors.body.NOXPUB);

			if (!c.get("body").type)
				return HttpServer.sendError(c, errors.body.NOTYPE);

			// Extracts arguments
			const argumentXpub = stringField(c.get("body").xpub);
			const argumentSegwit = stringField(c.get("body").segwit);
			const argumentAction = stringField(c.get("body").type);
			const argumentForceOverride = c.get("body").force;
			if (argumentXpub == null || argumentAction == null)
				return HttpServer.sendError(c, errors.body.INVDATA);

			// Translate xpub if needed
			try {
				const returnValue = this.xlatHdAccount(argumentXpub, true);
				xpub = returnValue.xpub;
			} catch (error) {
				return HttpServer.sendError(c, error);
			}

			// Define the derivation scheme
			let scheme = hdaHelper.BIP44;

			if (argumentSegwit) {
				const segwit = argumentSegwit.toLowerCase();
				if (segwit === "bip49") scheme = hdaHelper.BIP49;
				else if (segwit === "bip84") scheme = hdaHelper.BIP84;
				else return HttpServer.sendError(c, errors.xpub.SEGWIT);
			}

			// Define default forceOverride if needed
			const forceOverride = argumentForceOverride === "true";

			// Process action
			if (argumentAction === "new") {
				// New hd account
				try {
					await hdaService.createHdAccount(xpub, scheme);
					HttpServer.sendOk(c);
				} catch (error) {
					HttpServer.sendError(c, error);
				}
			} else if (argumentAction === "restore") {
				// Restore hd account
				try {
					await hdaService.restoreHdAccount(xpub, scheme, forceOverride);
					HttpServer.sendOk(c);
				} catch (error) {
					HttpServer.sendError(c, error);
				}
			} else {
				// Unknown action
				return HttpServer.sendError(c, errors.body.INVTYPE);
			}
		} catch {
			return HttpServer.sendError(c, errors.generic.GEN);
		} finally {
			debugApi &&
				Logger.info(`API : Completed POST /xpub ${c.get("body").xpub}`);
		}
	}

	/**
	 * Handle xPub GET request
	 */
	async getXpub(c: HttpContext) {
		try {
			let xpub: string;

			// Extracts arguments
			const argumentXpub = c.req.param("xpub");

			// Translate xpub if needed
			try {
				const returnValue_ = this.xlatHdAccount(argumentXpub);
				xpub = returnValue_.xpub;
			} catch (error) {
				return HttpServer.sendError(c, error);
			}

			const hdaInfo = new HdAccountInfo(xpub);

			const info = await hdaInfo.loadInfo();
			if (!info) throw "Unable to load Xpub info";

			const returnValue = {
				balance: hdaInfo.finalBalance,
				unused: {
					external: hdaInfo.accountIndex,
					internal: hdaInfo.changeIndex,
				},
				derivation: hdaInfo.derivation,
				created: hdaInfo.created,
			};

			HttpServer.sendOkData(c, returnValue);
		} catch (error) {
			Logger.error(error, "API : XpubRestApi.getXpub()");
			HttpServer.sendError(c, error);
		} finally {
			debugApi &&
				Logger.info(`API : Completed GET /xpub/${c.req.param("xpub")}`);
		}
	}

	/**
	 * Handle xPub/import/status GET request
	 */
	async getXpubImportStatus(c: HttpContext) {
		try {
			let xpub: string;

			// Extracts arguments
			const argumentXpub = c.req.param("xpub");

			// Translate xpub if needed
			try {
				const xlatXpub = this.xlatHdAccount(argumentXpub);
				xpub = xlatXpub.xpub;
			} catch (error) {
				return HttpServer.sendError(c, error);
			}

			const returnValue: ImportStatusResponse = {
				import_in_progress: false,
			};

			const status = await hdaService.importInProgress(xpub);
			if (status != null) {
				returnValue.import_in_progress = true;
				if (status !== true) {
					returnValue.status = status.status;
					returnValue.hits =
						returnValue.status === remoteImporter.STATUS_RESCAN
							? (status.txs_int ?? 0) + (status.txs_ext ?? 0)
							: (status.txs ?? 0);
				}
			}

			HttpServer.sendOkData(c, returnValue);
		} catch (error) {
			Logger.error(error, "API : XpubRestApi.getXpubImportStatus()");
			HttpServer.sendError(c, error);
		} finally {
			debugApi &&
				Logger.info(
					`API : Completed GET /xpub/${c.req.param("xpub")}/import/status`,
				);
		}
	}

	/**
	 * Handle Lock XPub POST request
	 */
	async postLockXpub(c: HttpContext) {
		try {
			let xpub: string;
			let scheme: number;

			// Check request arguments
			if (!c.get("body")) return HttpServer.sendError(c, errors.body.NODATA);

			if (!c.get("body").address)
				return HttpServer.sendError(c, errors.body.NOADDR);

			if (!c.get("body").signature)
				return HttpServer.sendError(c, errors.body.NOSIG);

			if (!c.get("body").message)
				return HttpServer.sendError(c, errors.body.NOMSG);

			if (
				!(
					c.get("body").message === "lock" || c.get("body").message === "unlock"
				)
			)
				return HttpServer.sendError(c, errors.sig.INVMSG);

			// Extract arguments
			const argumentXpub = c.req.param("xpub");
			const argumentAddr = stringField(c.get("body").address);
			const argumentSig = stringField(c.get("body").signature);
			const argumentMessage = stringField(c.get("body").message);
			if (
				argumentAddr == null ||
				argumentSig == null ||
				argumentMessage == null
			)
				return HttpServer.sendError(c, errors.body.INVDATA);

			// Translate xpub if needed
			try {
				const returnValue = this.xlatHdAccount(argumentXpub);
				xpub = returnValue.xpub;
				scheme = returnValue.scheme;
			} catch (error) {
				return HttpServer.sendError(c, error);
			}

			try {
				// Check the signature and process the request
				await hdaService.verifyXpubSignature(
					xpub,
					argumentAddr,
					argumentSig,
					argumentMessage,
					scheme,
				);
				const lock = argumentMessage !== "unlock";
				const returnValue = await hdaService.lockHdAccount(xpub, lock);
				HttpServer.sendOkData(c, { derivation: returnValue });
			} catch {
				HttpServer.sendError(c, errors.generic.GEN);
			}
		} finally {
			debugApi &&
				Logger.info(`API : Completed POST /xpub/${c.req.param("xpub")}/lock`);
		}
	}

	/**
	 * Handle XPub DELETE request
	 */
	async deleteXpub(c: HttpContext) {
		try {
			let xpub: string;
			let scheme: number;

			// Check request arguments
			if (!c.get("body")) return HttpServer.sendError(c, errors.body.NODATA);

			if (!c.get("body").address)
				return HttpServer.sendError(c, errors.body.NOADDR);

			if (!c.get("body").signature)
				return HttpServer.sendError(c, errors.body.NOSIG);

			// Extract arguments
			const argumentXpub = c.req.param("xpub");
			const argumentAddr = stringField(c.get("body").address);
			const argumentSig = stringField(c.get("body").signature);
			if (argumentAddr == null || argumentSig == null)
				return HttpServer.sendError(c, errors.body.INVDATA);

			// Translate xpub if needed
			try {
				const returnValue = this.xlatHdAccount(argumentXpub);
				xpub = returnValue.xpub;
				scheme = returnValue.scheme;
			} catch (error) {
				return HttpServer.sendError(c, error);
			}

			try {
				// Check the signature and process the request
				await hdaService.verifyXpubSignature(
					xpub,
					argumentAddr,
					argumentSig,
					argumentXpub,
					scheme,
				);
				await hdaService.deleteHdAccount(xpub);
				HttpServer.sendOk(c);
			} catch (error) {
				HttpServer.sendError(c, error);
			}
		} catch {
			HttpServer.sendError(c, errors.generic.GEN);
		} finally {
			debugApi &&
				Logger.info(`API : Completed DELETE /xpub/${c.req.param("xpub")}`);
		}
	}

	/**
	 * Translate a ypub/zpub into a xpub
	 */
	xlatHdAccount(origXpub?: string, trace?: boolean): XlatHdAccountResult {
		try {
			// Translate xpub if needed
			let xpub = origXpub;
			let scheme = hdaHelper.BIP44;

			const isYpub = hdaHelper.isYpub(origXpub);
			const isZpub = hdaHelper.isZpub(origXpub);

			if (isYpub || isZpub) {
				xpub = hdaHelper.xlatXPUB(origXpub);
				scheme = isYpub ? hdaHelper.BIP49 : hdaHelper.BIP84;
				if (trace) {
					Logger.info(`API : Converted: ${origXpub}`);
					Logger.info(`API : Resulting xpub: ${xpub}`);
				}
			}

			if (!hdaHelper.isValid(xpub)) throw errors.xpub.INVALID;

			return {
				xpub: xpub,
				scheme: scheme,
			};
		} catch (error) {
			const error_ =
				error === errors.xpub.PRIVKEY ? error : errors.xpub.INVALID;
			throw error_;
		}
	}

	/**
	 * Validate arguments of postXpub requests
	 */
	async validateArgsPostXpub(c: HttpContext, next: HttpNext) {
		const xpub = stringField(c.get("body").xpub);
		const segwit = stringField(c.get("body").segwit);
		const type = stringField(c.get("body").type);
		const force = stringField(c.get("body").force);
		const isValidXpub = xpub != null && validator.isAlphanumeric(xpub);

		const isValidSegwit = segwit == null || validator.isAlphanumeric(segwit);

		const isValidType = type == null || validator.isAlphanumeric(type);

		const isValidForce = force == null || validator.isAlphanumeric(force);

		if (isValidXpub && isValidSegwit && isValidType && isValidForce) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				c.get("body"),
				"API : XpubRestApi.validateArgsPostXpub() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate arguments of getXpub requests
	 */
	async validateArgsGetXpub(c: HttpContext, next: HttpNext) {
		const isValidXpub = validator.isAlphanumeric(c.req.param("xpub"));

		if (isValidXpub) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				c.req.param("xpub"),
				"API : XpubRestApi.validateArgsGetXpub() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate arguments of postLockXpub requests
	 */
	async validateArgsPostLockXpub(c: HttpContext, next: HttpNext) {
		const isValidXpub = validator.isAlphanumeric(c.req.param("xpub"));
		const address = stringField(c.get("body").address);
		const signature = stringField(c.get("body").signature);
		const message = stringField(c.get("body").message);
		const isValidAddr = address != null && validator.isAlphanumeric(address);
		const isValidSig = signature != null && validator.isBase64(signature);
		const isValidMessage = message != null && validator.isAlphanumeric(message);

		if (isValidXpub && isValidAddr && isValidSig && isValidMessage) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				c.req.param(),
				"API : XpubRestApi.validateArgsPostLockXpub() : Invalid arguments",
			);
			Logger.error(c.get("body"), "");
		}
	}

	/**
	 * Validate arguments of deleteXpub requests
	 */
	async validateArgsDeleteXpub(c: HttpContext, next: HttpNext) {
		const isValidXpub = validator.isAlphanumeric(c.req.param("xpub"));
		const address = stringField(c.get("body").address);
		const signature = stringField(c.get("body").signature);
		const isValidAddr = address != null && validator.isAlphanumeric(address);
		const isValidSig = signature != null && validator.isBase64(signature);

		if (isValidXpub && isValidAddr && isValidSig) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				c.req.param(),
				"API : XpubRestApi.validateArgsDeleteXpub() : Invalid arguments",
			);
			Logger.error(c.get("body"), "");
		}
	}
}

export default XPubRestApi;

/*!
 * accounts/xpub-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { urlencoded } from "milliparsec";
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
		const urlencodedParser = urlencoded();

		this.httpServer.app.post(
			"/xpub/",
			urlencodedParser,
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
			urlencodedParser,
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsPostLockXpub.bind(this),
			this.postLockXpub.bind(this),
		);

		this.httpServer.app.delete(
			"/xpub/:xpub",
			urlencodedParser,
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsDeleteXpub.bind(this),
			this.deleteXpub.bind(this),
		);
	}

	/**
	 * Handle xPub POST request
	 */
	async postXpub(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			let xpub: string;

			// Check request arguments
			if (!req.body) return HttpServer.sendError(res, errors.body.NODATA);

			if (!req.body.xpub) return HttpServer.sendError(res, errors.body.NOXPUB);

			if (!req.body.type) return HttpServer.sendError(res, errors.body.NOTYPE);

			// Extracts arguments
			const argumentXpub = stringField(req.body.xpub);
			const argumentSegwit = stringField(req.body.segwit);
			const argumentAction = stringField(req.body.type);
			const argumentForceOverride = req.body.force;
			if (argumentXpub == null || argumentAction == null)
				return HttpServer.sendError(res, errors.body.INVDATA);

			// Translate xpub if needed
			try {
				const returnValue = this.xlatHdAccount(argumentXpub, true);
				xpub = returnValue.xpub;
			} catch (error) {
				return HttpServer.sendError(res, error);
			}

			// Define the derivation scheme
			let scheme = hdaHelper.BIP44;

			if (argumentSegwit) {
				const segwit = argumentSegwit.toLowerCase();
				if (segwit === "bip49") scheme = hdaHelper.BIP49;
				else if (segwit === "bip84") scheme = hdaHelper.BIP84;
				else return HttpServer.sendError(res, errors.xpub.SEGWIT);
			}

			// Define default forceOverride if needed
			const forceOverride = argumentForceOverride === "true";

			// Process action
			if (argumentAction === "new") {
				// New hd account
				try {
					await hdaService.createHdAccount(xpub, scheme);
					HttpServer.sendOk(res);
				} catch (error) {
					HttpServer.sendError(res, error);
				}
			} else if (argumentAction === "restore") {
				// Restore hd account
				try {
					await hdaService.restoreHdAccount(xpub, scheme, forceOverride);
					HttpServer.sendOk(res);
				} catch (error) {
					HttpServer.sendError(res, error);
				}
			} else {
				// Unknown action
				return HttpServer.sendError(res, errors.body.INVTYPE);
			}
		} catch {
			return HttpServer.sendError(res, errors.generic.GEN);
		} finally {
			debugApi && Logger.info(`API : Completed POST /xpub ${req.body.xpub}`);
		}
	}

	/**
	 * Handle xPub GET request
	 */
	async getXpub(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			let xpub: string;

			// Extracts arguments
			const argumentXpub = req.params.xpub;

			// Translate xpub if needed
			try {
				const returnValue_ = this.xlatHdAccount(argumentXpub);
				xpub = returnValue_.xpub;
			} catch (error) {
				return HttpServer.sendError(res, error);
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

			HttpServer.sendOkData(res, returnValue);
		} catch (error) {
			Logger.error(error, "API : XpubRestApi.getXpub()");
			HttpServer.sendError(res, error);
		} finally {
			debugApi && Logger.info(`API : Completed GET /xpub/${req.params.xpub}`);
		}
	}

	/**
	 * Handle xPub/import/status GET request
	 */
	async getXpubImportStatus(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			let xpub: string;

			// Extracts arguments
			const argumentXpub = req.params.xpub;

			// Translate xpub if needed
			try {
				const xlatXpub = this.xlatHdAccount(argumentXpub);
				xpub = xlatXpub.xpub;
			} catch (error) {
				return HttpServer.sendError(res, error);
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

			HttpServer.sendOkData(res, returnValue);
		} catch (error) {
			Logger.error(error, "API : XpubRestApi.getXpubImportStatus()");
			HttpServer.sendError(res, error);
		} finally {
			debugApi &&
				Logger.info(
					`API : Completed GET /xpub/${req.params.xpub}/import/status`,
				);
		}
	}

	/**
	 * Handle Lock XPub POST request
	 */
	async postLockXpub(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			let xpub: string;
			let scheme: number;

			// Check request arguments
			if (!req.body) return HttpServer.sendError(res, errors.body.NODATA);

			if (!req.body.address)
				return HttpServer.sendError(res, errors.body.NOADDR);

			if (!req.body.signature)
				return HttpServer.sendError(res, errors.body.NOSIG);

			if (!req.body.message)
				return HttpServer.sendError(res, errors.body.NOMSG);

			if (!(req.body.message === "lock" || req.body.message === "unlock"))
				return HttpServer.sendError(res, errors.sig.INVMSG);

			// Extract arguments
			const argumentXpub = req.params.xpub;
			const argumentAddr = stringField(req.body.address);
			const argumentSig = stringField(req.body.signature);
			const argumentMessage = stringField(req.body.message);
			if (
				argumentAddr == null ||
				argumentSig == null ||
				argumentMessage == null
			)
				return HttpServer.sendError(res, errors.body.INVDATA);

			// Translate xpub if needed
			try {
				const returnValue = this.xlatHdAccount(argumentXpub);
				xpub = returnValue.xpub;
				scheme = returnValue.scheme;
			} catch (error) {
				return HttpServer.sendError(res, error);
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
				HttpServer.sendOkData(res, { derivation: returnValue });
			} catch {
				HttpServer.sendError(res, errors.generic.GEN);
			}
		} finally {
			debugApi &&
				Logger.info(`API : Completed POST /xpub/${req.params.xpub}/lock`);
		}
	}

	/**
	 * Handle XPub DELETE request
	 */
	async deleteXpub(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			let xpub: string;
			let scheme: number;

			// Check request arguments
			if (!req.body) return HttpServer.sendError(res, errors.body.NODATA);

			if (!req.body.address)
				return HttpServer.sendError(res, errors.body.NOADDR);

			if (!req.body.signature)
				return HttpServer.sendError(res, errors.body.NOSIG);

			// Extract arguments
			const argumentXpub = req.params.xpub;
			const argumentAddr = stringField(req.body.address);
			const argumentSig = stringField(req.body.signature);
			if (argumentAddr == null || argumentSig == null)
				return HttpServer.sendError(res, errors.body.INVDATA);

			// Translate xpub if needed
			try {
				const returnValue = this.xlatHdAccount(argumentXpub);
				xpub = returnValue.xpub;
				scheme = returnValue.scheme;
			} catch (error) {
				return HttpServer.sendError(res, error);
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
				HttpServer.sendOk(res);
			} catch (error) {
				HttpServer.sendError(res, error);
			}
		} catch {
			HttpServer.sendError(res, errors.generic.GEN);
		} finally {
			debugApi &&
				Logger.info(`API : Completed DELETE /xpub/${req.params.xpub}`);
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
	validateArgsPostXpub(
		req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		const xpub = stringField(req.body.xpub);
		const segwit = stringField(req.body.segwit);
		const type = stringField(req.body.type);
		const force = stringField(req.body.force);
		const isValidXpub = xpub != null && validator.isAlphanumeric(xpub);

		const isValidSegwit = segwit == null || validator.isAlphanumeric(segwit);

		const isValidType = type == null || validator.isAlphanumeric(type);

		const isValidForce = force == null || validator.isAlphanumeric(force);

		if (isValidXpub && isValidSegwit && isValidType && isValidForce) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				req.body,
				"API : XpubRestApi.validateArgsPostXpub() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate arguments of getXpub requests
	 */
	validateArgsGetXpub(
		req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		const isValidXpub = validator.isAlphanumeric(req.params.xpub);

		if (isValidXpub) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				req.params.xpub,
				"API : XpubRestApi.validateArgsGetXpub() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate arguments of postLockXpub requests
	 */
	validateArgsPostLockXpub(
		req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		const isValidXpub = validator.isAlphanumeric(req.params.xpub);
		const address = stringField(req.body.address);
		const signature = stringField(req.body.signature);
		const message = stringField(req.body.message);
		const isValidAddr = address != null && validator.isAlphanumeric(address);
		const isValidSig = signature != null && validator.isBase64(signature);
		const isValidMessage = message != null && validator.isAlphanumeric(message);

		if (isValidXpub && isValidAddr && isValidSig && isValidMessage) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				req.params,
				"API : XpubRestApi.validateArgsPostLockXpub() : Invalid arguments",
			);
			Logger.error(req.body, "");
		}
	}

	/**
	 * Validate arguments of deleteXpub requests
	 */
	validateArgsDeleteXpub(
		req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		const isValidXpub = validator.isAlphanumeric(req.params.xpub);
		const address = stringField(req.body.address);
		const signature = stringField(req.body.signature);
		const isValidAddr = address != null && validator.isAlphanumeric(address);
		const isValidSig = signature != null && validator.isBase64(signature);

		if (isValidXpub && isValidAddr && isValidSig) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				req.params,
				"API : XpubRestApi.validateArgsDeleteXpub() : Invalid arguments",
			);
			Logger.error(req.body, "");
		}
	}
}

export default XPubRestApi;

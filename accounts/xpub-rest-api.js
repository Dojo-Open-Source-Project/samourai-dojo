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

/**
 * XPub API endpoints
 */
class XPubRestApi {
	/**
	 * Constructor
	 * @param {HttpServer} httpServer - HTTP server
	 */
	constructor(httpServer) {
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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async postXpub(req, res) {
		try {
			let xpub;

			// Check request arguments
			if (!req.body) return HttpServer.sendError(res, errors.body.NODATA);

			if (!req.body.xpub) return HttpServer.sendError(res, errors.body.NOXPUB);

			if (!req.body.type) return HttpServer.sendError(res, errors.body.NOTYPE);

			// Extracts arguments
			const argumentXpub = req.body.xpub;
			const argumentSegwit = req.body.segwit;
			const argumentAction = req.body.type;
			const argumentForceOverride = req.body.force;

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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async getXpub(req, res) {
		try {
			let xpub;

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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async getXpubImportStatus(req, res) {
		try {
			let xpub;

			// Extracts arguments
			const argumentXpub = req.params.xpub;

			// Translate xpub if needed
			try {
				const xlatXpub = this.xlatHdAccount(argumentXpub);
				xpub = xlatXpub.xpub;
			} catch (error) {
				return HttpServer.sendError(res, error);
			}

			const returnValue = {
				import_in_progress: false,
			};

			const status = hdaService.importInProgress(xpub);
			if (status != null) {
				returnValue.import_in_progress = true;
				returnValue.status = status.status;
				returnValue.hits =
					returnValue.status === remoteImporter.STATUS_RESCAN
						? status.txs_int + status.txs_ext
						: status.txs;
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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async postLockXpub(req, res) {
		try {
			let xpub, scheme;

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
			const argumentAddr = req.body.address;
			const argumentSig = req.body.signature;
			const argumentMessage = req.body.message;

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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 */
	async deleteXpub(req, res) {
		try {
			let xpub, scheme;

			// Check request arguments
			if (!req.body) return HttpServer.sendError(res, errors.body.NODATA);

			if (!req.body.address)
				return HttpServer.sendError(res, errors.body.NOADDR);

			if (!req.body.signature)
				return HttpServer.sendError(res, errors.body.NOSIG);

			// Extract arguments
			const argumentXpub = req.params.xpub;
			const argumentAddr = req.body.address;
			const argumentSig = req.body.signature;

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
	 * @param {string} origXpub - original hd account
	 * @param {boolean} trace - flag indicating if we shoudl trace the conversion in our logs
	 * @returns {object} returns an object {xpub: <translated_xpub>, scheme: <derivation_scheme>}
	 *  or raises an exception
	 */
	xlatHdAccount(origXpub, trace) {
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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 * @param {function} next - next tiny-http middleware
	 */
	validateArgsPostXpub(req, res, next) {
		const isValidXpub = validator.isAlphanumeric(req.body.xpub);

		const isValidSegwit =
			!req.body.segwit || validator.isAlphanumeric(req.body.segwit);

		const isValidType =
			!req.body.type || validator.isAlphanumeric(req.body.type);

		const isValidForce =
			!req.body.force || validator.isAlphanumeric(req.body.force);

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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 * @param {function} next - next tiny-http middleware
	 */
	validateArgsGetXpub(req, res, next) {
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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 * @param {function} next - next tiny-http middleware
	 */
	validateArgsPostLockXpub(req, res, next) {
		const isValidXpub = validator.isAlphanumeric(req.params.xpub);
		const isValidAddr = validator.isAlphanumeric(req.body.address);
		const isValidSig = validator.isBase64(req.body.signature);
		const isValidMessage = validator.isAlphanumeric(req.body.message);

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
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 * @param {function} next - next tiny-http middleware
	 */
	validateArgsDeleteXpub(req, res, next) {
		const isValidXpub = validator.isAlphanumeric(req.params.xpub);
		const isValidAddr = validator.isAlphanumeric(req.body.address);
		const isValidSig = validator.isBase64(req.body.signature);

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

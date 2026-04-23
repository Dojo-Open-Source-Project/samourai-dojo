/*!
 * accounts/api-helper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import * as bitcoin from "bitcoinjs-lib";
import { fromHex } from "uint8array-tools";
import validator from "validator";
import addrHelper from "../lib/bitcoin/addresses-helper.js";
import hdaHelper from "../lib/bitcoin/hd-accounts-helper.js";
import network from "../lib/bitcoin/network.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import WalletEntities from "../lib/wallet/wallet-entities.js";

const activeNet = network.network;

/**
 * A singleton providing util methods used by the API
 */
class ApiHelper {
	/**
	 * Parse a string and extract (x|y|z|t|u|v)pubs, addresses and pubkeys
	 * @param {string} entities - list of entities separated by '|'
	 * @returns {object} returns a WalletEntities object
	 */
	parseEntities(entities) {
		const returnValue = new WalletEntities();

		if (typeof entities !== "string") return returnValue;

		for (let item of entities.split("|")) {
			try {
				if (hdaHelper.isValid(item) && !returnValue.hasXPub(item)) {
					const xpub = hdaHelper.xlatXPUB(item);

					if (hdaHelper.isYpub(item))
						returnValue.addHdAccount(xpub, item, false);
					else if (hdaHelper.isZpub(item))
						returnValue.addHdAccount(xpub, false, item);
					else returnValue.addHdAccount(item, false, false);
				} else if (
					addrHelper.isSupportedPubKey(item) &&
					!returnValue.hasPubKey(item)
				) {
					// Derive pubkey as 3 addresses (P1PKH, P2WPKH/P2SH, BECH32)
					const bufItem = fromHex(item);

					const funcs = [
						addrHelper.p2pkhAddress,
						addrHelper.p2wpkhP2shAddress,
						addrHelper.p2wpkhAddress,
					];

					for (const f of funcs) {
						const addr = f(bufItem);
						if (returnValue.hasAddress(addr))
							returnValue.updatePubKey(addr, item);
						else returnValue.addAddress(addr, item);
					}
				} else if (
					bitcoin.address.toOutputScript(item, activeNet) &&
					!returnValue.hasAddress(item)
				) {
					// Bech32 addresses are managed in lower case
					if (addrHelper.isBech32(item)) item = item.toLowerCase();
					returnValue.addAddress(item, false);
				}
			} catch (error) {
				Logger.error(
					error,
					"API : ApiHelper.parseEntities() : Invalid arguments",
				);
			}
		}

		return returnValue;
	}

	/**
	 * Check entities passed as url params
	 * @param {object} params - request query or body object
	 * @returns {boolean} return true if conditions are met, false otherwise
	 */
	checkEntitiesParams(params) {
		return (
			params.active ||
			params.new ||
			params.pubkey ||
			params.bip49 ||
			params.bip84
		);
	}

	/**
	 * Parse the entities passed as arguments of an url
	 * @param {object} params - request query or body object
	 * @returns {object} return a mapping object
	 *    {active:..., legacy:..., pubkey:..., bip49:..., bip84:...}
	 */
	parseEntitiesParams(params) {
		return {
			active: this.parseEntities(params.active),
			legacy: this.parseEntities(params.new),
			pubkey: this.parseEntities(params.pubkey),
			bip49: this.parseEntities(params.bip49),
			bip84: this.parseEntities(params.bip84),
		};
	}

	/**
	 * Express middleware validating if entities params are well formed
	 * @param {object} req - http request object
	 * @param {object} res - http response object
	 * @param {function} next - next tiny-http middleware
	 */
	validateEntitiesParams(req, res, next) {
		const parameters = this.checkEntitiesParams(req.query)
			? req.query
			: req.body;

		let isValid = true;

		if (parameters.active && !this.subValidateEntitiesParams(parameters.active))
			isValid &= false;

		if (parameters.new && !this.subValidateEntitiesParams(parameters.new))
			isValid &= false;

		if (parameters.pubkey && !this.subValidateEntitiesParams(parameters.pubkey))
			isValid &= false;

		if (parameters.bip49 && !this.subValidateEntitiesParams(parameters.bip49))
			isValid &= false;

		if (parameters.bip84 && !this.subValidateEntitiesParams(parameters.bip84))
			isValid &= false;

		if (isValid) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				parameters,
				"API : ApiHelper.validateEntitiesParams() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate a request argument
	 * @param {string} arg - request argument
	 */
	subValidateEntitiesParams(arg) {
		for (const item of arg.split("|")) {
			const isValid = validator.isAlphanumeric(item);
			if (!isValid) return false;
		}
		return true;
	}
}

export default new ApiHelper();

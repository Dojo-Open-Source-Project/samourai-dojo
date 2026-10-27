/*!
 * accounts/api-helper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import * as bitcoin from "bitcoinjs-lib";
import validator from "validator";
import addrHelper from "../lib/bitcoin/addresses-helper.js";
import hdaHelper from "../lib/bitcoin/hd-accounts-helper.js";
import network from "../lib/bitcoin/network.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import WalletEntities from "../lib/wallet/wallet-entities.js";

const activeNet = network.network;

type EntityParams = Partial<
	Record<"active" | "new" | "pubkey" | "bip49" | "bip84", unknown>
>;

/**
 * A singleton providing util methods used by the API
 */
class ApiHelper {
	/**
	 * Parse a string and extract (x|y|z|t|u|v)pubs, addresses and pubkeys
	 */
	parseEntities(entities?: unknown) {
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
					const bufItem = Buffer.from(item, "hex");

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
	 */
	checkEntitiesParams(params?: EntityParams) {
		return (
			params?.active ||
			params?.new ||
			params?.pubkey ||
			params?.bip49 ||
			params?.bip84
		);
	}

	/**
	 * Parse the entities passed as arguments of an url
	 */
	parseEntitiesParams(params: EntityParams) {
		return {
			active: this.parseEntities(params.active),
			legacy: this.parseEntities(params.new),
			pubkey: this.parseEntities(params.pubkey),
			bip49: this.parseEntities(params.bip49),
			bip84: this.parseEntities(params.bip84),
		};
	}

	/**
	 * Hono middleware validating if entities params are well formed
	 */
	async validateEntitiesParams(c: HttpContext, next: HttpNext) {
		const parameters = this.checkEntitiesParams(c.req.query())
			? c.req.query()
			: c.get("body");

		let isValid = true;

		if (parameters.active && !this.subValidateEntitiesParams(parameters.active))
			isValid = false;

		if (parameters.new && !this.subValidateEntitiesParams(parameters.new))
			isValid = false;

		if (parameters.pubkey && !this.subValidateEntitiesParams(parameters.pubkey))
			isValid = false;

		if (parameters.bip49 && !this.subValidateEntitiesParams(parameters.bip49))
			isValid = false;

		if (parameters.bip84 && !this.subValidateEntitiesParams(parameters.bip84))
			isValid = false;

		if (isValid) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				parameters,
				"API : ApiHelper.validateEntitiesParams() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate a request argument
	 */
	subValidateEntitiesParams(arg?: unknown) {
		if (typeof arg !== "string") return false;
		for (const item of arg.split("|")) {
			const isValid = validator.isAlphanumeric(item);
			if (!isValid) return false;
		}
		return true;
	}
}

export default new ApiHelper();

/*!
 * lib/remote-importer/sources.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";

const keys = keysFile[network.key];

/**
 * Base class defining data source for imports/rescans of HD accounts and addresses
 */
class Sources {
	constructor() {
		this.source = null;
	}

	/**
	 * Retrieve information for a given address
	 * @param {string} address - bitcoin address
	 * @param {boolean} filterAddr - True if an upper bound should be used
	 *     for #transactions associated to the address, False otherwise
	 * @returns {Promise} returns an object
	 *  { address: <bitcoin_address>, txids: <txids>, ntx: <total_nb_txs>}
	 */
	async getAddress(address, filterAddr) {
		const returnValue = {
			address,
			txids: [],
			ntx: 0,
		};

		try {
			const result = await this.source.getAddress(address, filterAddr);

			if (result.ntx) returnValue.ntx = result.ntx;
			else if (result.txids) returnValue.ntx = result.txids.length;

			if (result.txids) returnValue.txids = result.txids;
		} catch (error) {
			Logger.error(
				error,
				`Importer : Sources.getAddress() : ${address} from ${this.source.base}`,
			);
		}

		return returnValue;
	}

	/**
	 * Retrieve information for a list of addresses
	 * @param {string[]} addresses - array of bitcoin address
	 * @param {boolean=} filterAddr - True if an upper bound should be used
	 *    for #transactions associated to the address, False otherwise
	 * @returns {Promise<{address: string, txids: string[], ntx: number}[]>} returns an object
	 *    { address: <bitcoin_address>, txids: <txids>, ntx: <total_nb_txs>}
	 */
	async getAddresses(addresses, filterAddr) {
		const returnValue = [];

		try {
			const results = await this.source.getAddresses(addresses, filterAddr);

			for (const r of results) {
				// Filter addresses with too many txs
				if (!filterAddr || r.ntx <= keys.addrFilterThreshold)
					returnValue.push(r);
			}
		} catch (error) {
			Logger.error(
				error,
				`Importer : Sources.getAddresses() : Error while requesting ${addresses} from ${this.source.base}`,
			);
		}

		return returnValue;
	}

	/**
	 * Retrieve the height of the chaintip
	 * @returns {Promise<{ chainTipHeight: number | null }>} returns an object
	 */
	async getChainTipHeight() {
		let returnValue = { chainTipHeight: null };
		try {
			returnValue = await this.source.getChainTipHeight();
		} catch (error) {
			Logger.error(
				error,
				"Importer : Sources.getChainTipHeight() : Error while retrieving the chaintip",
			);
		}

		return returnValue;
	}
}

export default Sources;

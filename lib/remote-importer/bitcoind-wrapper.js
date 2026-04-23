/*!
 * lib/remote-importer/bitcoind-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { fromHex } from "uint8array-tools";
import keysFile from "../../keys/index.js";
import addrHelper from "../bitcoin/addresses-helper.js";
import network from "../bitcoin/network.js";
import rpcLatestBlock from "../bitcoind-rpc/latest-block.js";
import { createRpcClient } from "../bitcoind-rpc/rpc-client.js";
import Logger from "../logger.js";
import Wrapper from "./wrapper.js";

const keys = keysFile[network.key];

/**
 * Wrapper for a local bitcoind RPC API
 */
class BitcoindWrapper extends Wrapper {
	constructor() {
		super("bitcoind", null);
		// RPC client
		this.client = createRpcClient({ timeout: 5 * 60 * 1000 });
	}

	/**
	 * Send a request to the RPC API
	 * @param {array} descriptors - array of output descriptors
	 *  expected by scantxoutset()
	 * @returns {Promise}
	 */
	async _get(descriptors) {
		return await this.client.scantxoutset({
			action: "start",
			scanobjects: descriptors,
		});
	}

	/**
	 * Translate a scriptPubKey into an address
	 * @param {string} scriptPubKey - ScriptPubKey in hex format
	 * @returns {string | null} returns the bitcoin address corresponding to the scriptPubKey
	 */
	_xlatScriptPubKey(scriptPubKey) {
		const bScriptPubKey = fromHex(scriptPubKey);
		return addrHelper.outputScript2Address(bScriptPubKey);
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
			address: address,
			ntx: 0,
			txids: [],
		};

		const descriptor = `addr(${address})`;
		const results = await this._get([descriptor]);

		for (const r of results.unspents) {
			returnValue.txids.push(r.txid);
			returnValue.ntx++;
		}

		if (filterAddr && returnValue.ntx > keys.addrFilterThreshold) {
			Logger.info(
				`Importer : Import of ${address} rejected (too many transactions - ${returnValue.ntx})`,
			);
			return {
				address: address,
				ntx: 0,
				txids: [],
			};
		}

		return returnValue;
	}

	/**
	 * Retrieve information for a given list of addresses
	 * @param {string} addresses - array of bitcoin addresses
	 * @param {boolean} filterAddr - True if an upper bound should be used
	 *     for #transactions associated to the address, False otherwise
	 * @returns {Promise} returns an array of objects
	 *  { address: <bitcoin_address>, txids: <txids>, ntx: <total_nb_txs>}
	 */
	async getAddresses(addresses, filterAddr) {
		const returnValue = {};

		// Send a batch request for all the addresses
		const descriptors = addresses.map((a) => `addr(${a})`);

		const results = await this._get(descriptors);

		for (const r of results.unspents) {
			const addr = this._xlatScriptPubKey(r.scriptPubKey);

			if (addr) {
				if (!returnValue[addr]) {
					returnValue[addr] = {
						address: addr,
						ntx: 0,
						txids: [],
					};
				}

				returnValue[addr].txids.push(r.txid);
				returnValue[addr].ntx++;
			}
		}

		const aReturnValue = Object.values(returnValue);

		for (const index in aReturnValue) {
			if (filterAddr && aReturnValue[index].ntx > keys.addrFilterThreshold) {
				Logger.info(
					`Importer : Import of ${aReturnValue[index].address} rejected (too many transactions - ${aReturnValue[index].ntx})`,
				);
				aReturnValue.splice(index, 1);
			}
		}

		return aReturnValue;
	}

	/**
	 * Retrieve the height of the chaintip for the remote source
	 * @returns {Promise} returns an object
	 *    {chainTipHeight: <chaintip_height>}
	 */
	async getChainTipHeight() {
		return { chainTipHeight: rpcLatestBlock.height };
	}
}

export default BitcoindWrapper;

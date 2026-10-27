/*!
 * lib/remote-importer/local-rest-indexer-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import * as bitcoin from "bitcoinjs-lib";
import { fetch } from "undici";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";
import Wrapper, {
	type ChainTipInfo,
	type RemoteAddressInfo,
} from "./wrapper.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;
const activeNet = network.network;

/**
 * Wrapper for a local indexer
 * providing a REST API
 */
class LocalRestIndexerWrapper extends Wrapper {
	/**
	 * Constructor
	 * @constructor
	 */
	constructor(url?: string) {
		super(url, null);
	}

	/**
	 * Send a GET request to the API
	 */
	async _get(route?: string): Promise<unknown> {
		const parameters = {
			method: "GET",
			timeout: 15000,
			headers: {
				Accept: "application/json",
				"User-Agent": "Dojo",
			},
		};

		const response = await fetch(`${this.base}${route}`, parameters);

		if (!response.ok)
			throw new Error(`Receive invalid status from server: ${response.status}`);

		return await response.json();
	}

	/**
	 * Translate a bitcoin address into a script hash
	 * (@see https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes)
	 */
	_getScriptHash(address?: string) {
		const bScriptPubKey = bitcoin.address.toOutputScript(address, activeNet);
		const bScriptHash = bitcoin.crypto.sha256(bScriptPubKey);
		return Buffer.from(bScriptHash.reverse()).toString("hex");
	}

	/**
	 * Retrieve information for a given address
	 */
	async getAddress(
		address = "",
		filterAddr?: boolean,
	): Promise<RemoteAddressInfo> {
		const returnValue: RemoteAddressInfo = {
			address: address,
			ntx: 0,
			txids: [],
		};

		const scriptHash = this._getScriptHash(address);
		const uri = `/blockchain/scripthash/${scriptHash}/history`;
		const results = (await this._get(uri)) as Array<{ tx_hash: string }>;

		for (const r of results) {
			returnValue.txids.push(r.tx_hash);
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
	 */
	async getAddresses(
		addresses: string[] = [],
		filterAddr?: boolean,
	): Promise<RemoteAddressInfo[]> {
		const returnValue: Record<string, RemoteAddressInfo> = {};
		const scriptHash2Address: Record<string, string> = {};
		const scriptHashes: string[] = [];

		for (const a of addresses) {
			const scriptHash = this._getScriptHash(a);
			scriptHashes.push(scriptHash);
			scriptHash2Address[scriptHash] = a;
		}

		const sScriptHashes = scriptHashes.join(",");
		const uri = `/blockchain/scripthashes/history?scripthashes=${sScriptHashes}`;
		const results = (await this._get(uri)) as Array<{
			script_hash: string;
			txids: string[];
		}>;

		for (const r of results) {
			const a = scriptHash2Address[r.script_hash];
			returnValue[a] = {
				address: a,
				ntx: r.txids.length,
				txids: r.txids,
			};
		}

		const aReturnValue = Object.values(returnValue);

		for (const index in aReturnValue) {
			if (filterAddr && aReturnValue[index].ntx > keys.addrFilterThreshold) {
				Logger.info(
					`Importer : Import of ${aReturnValue[index].address} rejected (too many transactions - ${aReturnValue[index].ntx})`,
				);
				aReturnValue.splice(Number(index), 1);
			}
		}

		return aReturnValue;
	}

	/**
	 * Retrieve the height of the chaintip for the remote source
	 */
	async getChainTipHeight(): Promise<ChainTipInfo> {
		let chainTipHeight = null;
		const result = (await this._get("/blocks/tip")) as {
			height?: string | number;
		};
		if (result != null && result.height != null)
			chainTipHeight = Number.parseInt(String(result.height), 10);
		return { chainTipHeight: chainTipHeight };
	}
}

export default LocalRestIndexerWrapper;

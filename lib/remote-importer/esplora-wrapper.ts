/*!
 * lib/remote-importer\esplora-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

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

/**
 * Wrapper for the esplora block explorer APIs
 */
class EsploraWrapper extends Wrapper {
	declare static NB_TXS_PER_PAGE: number;
	/**
	 * Constructor
	 * @constructor
	 */
	constructor(url?: string) {
		super(url, keys.indexer.socks5Proxy);
	}

	/**
	 * Send a GET request to the API
	 */
	async _get(route?: string): Promise<unknown> {
		const parameters: {
			method: string;
			timeout: number;
			headers: Record<string, string>;
			dispatcher?: typeof this.socksProxyAgent;
		} = {
			method: "GET",
			timeout: 15000,
			headers: {
				Accept: "application/json",
				"User-Agent": "Dojo",
			},
		};

		// Sets socks proxy agent if required
		if (keys.indexer.socks5Proxy != null) {
			parameters.dispatcher = this.socksProxyAgent;
		}

		const response = await fetch(`${this.base}${route}`, parameters);

		if (!response.ok)
			throw new Error(`Receive invalid status from server: ${response.status}`);

		return await response.json();
	}

	/**
	 * Get a page of transactions related to a given address
	 */
	async _getTxsForAddress(address = "", lastSeenTxid?: string | null) {
		let uri = `/api/address/${address}/txs`;
		if (lastSeenTxid) uri = `${uri}/chain/${lastSeenTxid}`;

		const results = (await this._get(uri)) as Array<{ txid: string }>;
		return results.map((tx) => tx.txid);
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

		let lastSeenTxid = null;

		while (true) {
			const txids = await this._getTxsForAddress(address, lastSeenTxid);

			if (txids.length === 0)
				// we have all the transactions
				return returnValue;

			returnValue.txids = [...returnValue.txids, ...txids];
			returnValue.ntx += txids.length;

			if (txids.length < EsploraWrapper.NB_TXS_PER_PAGE) {
				// we have all the transactions
				return returnValue;
			} else if (filterAddr && returnValue.ntx > keys.addrFilterThreshold) {
				// we have too many transactions
				Logger.info(
					`Importer : Import of ${returnValue.address} rejected (too many transactions - ${returnValue.ntx})`,
				);
				returnValue.txids = [];
				returnValue.ntx = 0;
				return returnValue;
			} else {
				// we need a new iteration
				lastSeenTxid = txids.at(-1);
			}
		}
	}

	/**
	 * Retrieve information for a given list of addresses
	 */
	async getAddresses(
		addresses: string[] = [],
		filterAddr?: boolean,
	): Promise<RemoteAddressInfo[]> {
		const returnValue: RemoteAddressInfo[] = [];

		for (const a of addresses) {
			const returnValueAddr = await this.getAddress(a, filterAddr);
			returnValue.push(returnValueAddr);
		}

		return returnValue;
	}

	/**
	 * Retrieve the height of the chaintip for the remote source
	 */
	async getChainTipHeight(): Promise<ChainTipInfo> {
		let chainTipHeight = null;
		const result = await this._get("/api/blocks/tip/height");
		if (typeof result === "string")
			chainTipHeight = Number.parseInt(result, 10);
		else if (typeof result === "number") chainTipHeight = result;
		return { chainTipHeight: chainTipHeight };
	}
}

// Esplora returns a max of 25 txs per page
EsploraWrapper.NB_TXS_PER_PAGE = 25;

export default EsploraWrapper;

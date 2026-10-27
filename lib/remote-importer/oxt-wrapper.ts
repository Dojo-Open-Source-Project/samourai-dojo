/*!
 * lib/remote-importer/oxt-wrapper.js
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
 * Wrapper for the oxt.me block explorer APIs
 */
class OxtWrapper extends Wrapper {
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
	 * Retrieve information for a given address
	 */
	async getAddress(
		address = "",
		filterAddr?: boolean,
	): Promise<RemoteAddressInfo> {
		// Try to retrieve more txs than the 1000 managed by the backend
		const uri = `/addresses/${address}/txids?count=${keys.addrFilterThreshold + 1}`;
		const result = (await this._get(uri)) as {
			count: number;
			data: Array<{ txid: string }>;
		};

		const returnValue: RemoteAddressInfo = {
			address: address,
			ntx: result.count,
			txids: [],
		};

		// Check if we should filter this address
		if (filterAddr && returnValue.ntx > keys.addrFilterThreshold) {
			Logger.info(
				`Importer : Import of ${returnValue.address} rejected (too many transactions - ${returnValue.ntx})`,
			);
			return returnValue;
		}

		returnValue.txids = result.data.map((t) => t.txid);
		return returnValue;
	}

	/**
	 * Retrieve information for a given list of addresses
	 */
	async getAddresses(
		addresses: string[] = [],
		filterAddr?: boolean,
	): Promise<RemoteAddressInfo[]> {
		const returnValue: RemoteAddressInfo[] = [];

		// Send a batch request for all the addresses
		// For each address, try to retrieve more txs than the 1000 managed by the backend
		const stringAddr = addresses.join(",");
		const uri = `/addresses/multi/txids?count=${keys.addrFilterThreshold + 1}&addresses=${stringAddr}`;
		const results = (await this._get(uri)) as {
			data: Array<{ address: string; txids: string[] }>;
		};

		for (const r of results.data) {
			const returnValueAddr: RemoteAddressInfo = {
				address: r.address,
				ntx: r.txids.length,
				txids: [],
			};

			// Check if we should filter this address
			if (filterAddr && returnValueAddr.ntx > keys.addrFilterThreshold) {
				Logger.info(
					`Importer : Import of ${returnValueAddr.address} rejected (too many transactions - ${returnValueAddr.ntx})`,
				);
			} else {
				returnValueAddr.txids = r.txids;
			}

			returnValue.push(returnValueAddr);
		}

		return returnValue;
	}

	/**
	 * Retrieve the height of the chaintip for the remote source
	 */
	async getChainTipHeight(): Promise<ChainTipInfo> {
		let chainTipHeight = null;
		const result = (await this._get("/lastblock")) as {
			data: Array<{ height: string }>;
		};
		if (result != null && result.data.length === 1)
			chainTipHeight = Number.parseInt(result.data[0].height, 10);
		return { chainTipHeight: chainTipHeight };
	}
}

export default OxtWrapper;

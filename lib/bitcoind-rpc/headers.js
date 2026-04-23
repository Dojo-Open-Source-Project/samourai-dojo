/*!
 * lib/bitcoind-rpc/headers.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import QuickLRU from "quick-lru";

import errors from "../errors.js";
import { createRpcClient } from "./rpc-client.js";

/**
 * A singleton providing information about block headers
 */
class Headers {
	constructor() {
		// Cache
		this.headers = new QuickLRU({
			// Maximum number of headers to store in cache
			maxSize: 2016,
			// Maximum age for items in the cache. Items do not expire
			maxAge: Number.POSITIVE_INFINITY,
		});

		// Initialize the rpc client
		this.rpcClient = createRpcClient();
	}

	/**
	 * Get the block header for a given hash
	 * @param {string} hash - block hash
	 * @returns {Promise}
	 */
	async getHeader(hash) {
		if (this.headers.has(hash)) return this.headers.get(hash);

		try {
			const header = await this.rpcClient.getblockheader({
				blockhash: hash,
				verbose: true,
			});
			const fmtHeader = JSON.stringify(header, null, 2);
			this.headers.set(hash, fmtHeader);
			return fmtHeader;
		} catch {
			throw errors.generic.GEN;
		}
	}
}

export default new Headers();

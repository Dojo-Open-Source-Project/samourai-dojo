/*!
 * lib/remote-importer/wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { socksDispatcher } from "../fetch-socks/fetch-socks.js";

export interface RemoteAddressInfo {
	address: string;
	txids: string[];
	ntx: number;
}

export interface ChainTipInfo {
	chainTipHeight: number | null;
}

/**
 * Abstract class defining a wrapper for a remote API
 * @abstract
 */
class Wrapper {
	declare base: string | null;
	declare socksProxyAgent: ReturnType<typeof socksDispatcher> | null;
	/**
	 * Constructor
	 * @constructor
	 */
	constructor(url?: string | null, socks5Proxy?: string | null) {
		this.base = url;
		this.socksProxyAgent = socks5Proxy
			? socksDispatcher({
					type: 5,
					host: new URL(socks5Proxy).host,
					port: Number.parseInt(new URL(socks5Proxy).port, 10),
				})
			: null;
	}

	/**
	 * Retrieve information for a given address
	 */
	async getAddress(
		_address?: string,
		_filterAddr?: boolean,
	): Promise<RemoteAddressInfo> {
		throw new Error("Wrapper.getAddress() must be implemented by subclasses");
	}

	/**
	 * Retrieve information for a given list of addresses
	 */
	async getAddresses(
		_addresses?: string[],
		_filterAddr?: boolean,
	): Promise<RemoteAddressInfo[]> {
		throw new Error("Wrapper.getAddresses() must be implemented by subclasses");
	}

	async getChainTipHeight(): Promise<ChainTipInfo> {
		throw new Error(
			"Wrapper.getChainTipHeight() must be implemented by subclasses",
		);
	}
}

export default Wrapper;

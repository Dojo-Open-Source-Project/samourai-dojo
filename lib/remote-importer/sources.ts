/*!
 * lib/remote-importer/sources.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";
import type Wrapper from "./wrapper.js";
import type { ChainTipInfo, RemoteAddressInfo } from "./wrapper.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * Base class defining data source for imports/rescans of HD accounts and addresses
 */
class Sources {
	declare source: Wrapper | null;
	constructor() {
		this.source = null;
	}

	/**
	 * Retrieve information for a given address
	 */
	async getAddress(
		address = "",
		filterAddr?: boolean,
	): Promise<RemoteAddressInfo> {
		const returnValue: RemoteAddressInfo = {
			address,
			txids: [],
			ntx: 0,
		};

		try {
			if (this.source == null) throw new Error("Importer source is missing");
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
	 */
	async getAddresses(
		addresses: string[] = [],
		filterAddr?: boolean,
	): Promise<RemoteAddressInfo[]> {
		const returnValue: RemoteAddressInfo[] = [];

		try {
			if (this.source == null) throw new Error("Importer source is missing");
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
	 */
	async getChainTipHeight(): Promise<ChainTipInfo> {
		let returnValue: ChainTipInfo = { chainTipHeight: null };
		try {
			if (this.source == null) throw new Error("Importer source is missing");
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

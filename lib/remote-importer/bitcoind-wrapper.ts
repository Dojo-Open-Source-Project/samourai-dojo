/*!
 * lib/remote-importer/bitcoind-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../../keys/index.js";
import addrHelper from "../bitcoin/addresses-helper.js";
import network from "../bitcoin/network.js";
import rpcLatestBlock from "../bitcoind-rpc/latest-block.js";
import {
	createRpcClient,
	type DojoRpcClient,
} from "../bitcoind-rpc/rpc-client.js";
import Logger from "../logger.js";
import Wrapper, {
	type ChainTipInfo,
	type RemoteAddressInfo,
} from "./wrapper.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * Wrapper for a local bitcoind RPC API
 */
class BitcoindWrapper extends Wrapper {
	declare client: DojoRpcClient;
	constructor() {
		super("bitcoind", null);
		// RPC client
		this.client = createRpcClient({ timeout: 5 * 60 * 1000 });
	}

	/**
	 * Send a request to the RPC API
	 */
	async _get(descriptors: string[]) {
		return (await this.client.scantxoutset({
			action: "start",
			scanobjects: descriptors,
		})) as unknown as {
			unspents: Array<{ txid: string; scriptPubKey: string }>;
		};
	}

	/**
	 * Translate a scriptPubKey into an address
	 */
	_xlatScriptPubKey(scriptPubKey?: string) {
		const bScriptPubKey = Buffer.from(scriptPubKey, "hex");
		return addrHelper.outputScript2Address(bScriptPubKey);
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
	 */
	async getAddresses(
		addresses: string[] = [],
		filterAddr?: boolean,
	): Promise<RemoteAddressInfo[]> {
		const returnValue: Record<string, RemoteAddressInfo> = {};

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
				aReturnValue.splice(Number(index), 1);
			}
		}

		return aReturnValue;
	}

	/**
	 * Retrieve the height of the chaintip for the remote source
	 */
	async getChainTipHeight(): Promise<ChainTipInfo> {
		return { chainTipHeight: rpcLatestBlock.height };
	}
}

export default BitcoindWrapper;

/*!
 * lib/remote-importer/local-indexer-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import net from "node:net";
import { ElectrumClient } from "@dojo-tools/electrum-client";
import * as bitcoin from "bitcoinjs-lib";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";
import Util from "../util.js";
import Wrapper, {
	type ChainTipInfo,
	type RemoteAddressInfo,
} from "./wrapper.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;
const activeNet = network.network;

interface ElectrumHistoryItem {
	tx_hash: string;
}

interface ElectrumBatchHistory {
	param: string;
	result: ElectrumHistoryItem[];
}

interface ElectrumHeaderSubscription {
	height?: number | string;
}

/**
 * @description Detects if a network port is reachable
 * @return {Promise<boolean>}
 */
async function isPortReachable(port: number, host: string, timeout = 1000) {
	if (typeof host !== "string") {
		throw new TypeError("Specify a `host`");
	}

	const promise = new Promise<void>((resolve, reject) => {
		const socket = new net.Socket();

		const onError = () => {
			socket.destroy();
			reject();
		};

		socket.setTimeout(timeout);
		socket.once("error", onError);
		socket.once("timeout", onError);

		socket.connect(port, host, () => {
			socket.end();
			resolve();
		});
	});

	try {
		await promise;
		return true;
	} catch {
		return false;
	}
}

/**
 * @description Returns a promise that resolves when indexer API is available
 * @return {Promise<void>}
 */
const getActiveIndexer = (port: number, host: string) => {
	return new Promise<void>((resolve) => {
		const interval = setInterval(async () => {
			const isReachable = await isPortReachable(port, host);

			if (isReachable) {
				clearInterval(interval);
				resolve();
			} else {
				Logger.info("Importer : Indexer not available, retrying in 20 seconds");
			}
		}, 20000);
	});
};

/**
 * Wrapper for a local indexer
 * Currently supports indexers
 * providing a RPC API compliant
 * with a subset of the electrum protocol
 */
class LocalIndexerWrapper extends Wrapper {
	declare client: ElectrumClient;
	constructor() {
		super(null, null);

		this.client = new ElectrumClient(
			keys.indexer.localIndexer.port,
			keys.indexer.localIndexer.host,
			keys.indexer.localIndexer.protocol,
			{
				onError: (error?: unknown) =>
					Logger.error(error, "Importer : Electrum client error"),
				onConnect: () =>
					Logger.info("Importer : Successfully connected to indexer"),
				onClose: () => Logger.info("Importer : Connection to indexer closed"),
				onLog: (msg?: string) => Logger.info(`Importer : ${msg}`),
			},
		);

		getActiveIndexer(
			keys.indexer.localIndexer.port,
			keys.indexer.localIndexer.host,
		).then(() => {
			const init = () =>
				this.client
					.initElectrum(
						{ client: `Samourai Dojo v${keys.dojoVersion}`, version: "1.4" },
						{
							retryPeriod: 3000, // 3 SECONDS
							pingPeriod: 60 * 1000, // 1 MINUTE
							callback: async () => {
								Logger.error(null, "Importer : Cannot reconnect to indexer");
								await Util.delay(60 * 1000);
								init();
							},
						},
					)
					.catch(async (error?: unknown) => {
						Logger.error(error, "Importer : Error when connecting to indexer");
						await Util.delay(60 * 1000);
						init();
					});

			init();
		});
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

		const results = (await this.client.blockchainScripthash_getHistory(
			scriptHash,
		)) as ElectrumHistoryItem[];

		returnValue.ntx = results.length;
		returnValue.txids = results.map((tx) => tx.tx_hash);

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
		let returnValue: RemoteAddressInfo[];

		// Build a Map of script hashes and addresses
		const scriptHashAddrMap = new Map(
			addresses.map((address) => [this._getScriptHash(address), address]),
		);
		const scriptHashes = [...scriptHashAddrMap.keys()];

		if (keys.indexer.localIndexer.batchRequests === "active") {
			const scriptHashChunks = Util.splitList(scriptHashes, 50);
			const rpcResults = await Util.seriesCall(scriptHashChunks, (chunk) =>
				this.client.blockchainScripthash_getHistoryBatch(chunk),
			);

			returnValue = (rpcResults.flat() as ElectrumBatchHistory[]).map(
				(rpcResult) => ({
					address: scriptHashAddrMap.get(rpcResult.param),
					ntx: rpcResult.result.length,
					txids: rpcResult.result.map((tx) => tx.tx_hash),
				}),
			);
		} else {
			returnValue = await Util.asyncPool(
				5,
				scriptHashes,
				async (scriptHash) => {
					const result = (await this.client.blockchainScripthash_getHistory(
						scriptHash,
					)) as ElectrumHistoryItem[];

					return {
						address: scriptHashAddrMap.get(scriptHash),
						ntx: result.length,
						txids: result.map((tx) => tx.tx_hash),
					};
				},
			);
		}

		if (filterAddr) {
			return returnValue.filter((val) => {
				if (val.ntx > keys.addrFilterThreshold) {
					Logger.info(
						`Importer : Import of ${val.address} rejected (too many transactions - ${val.ntx})`,
					);
					return false;
				}

				return true;
			});
		}

		return returnValue;
	}

	/**
	 * Retrieve the height of the chaintip for the remote source
	 */
	async getChainTipHeight(): Promise<ChainTipInfo> {
		let chainTipHeight = null;
		const result =
			(await this.client.blockchainHeaders_subscribe()) as ElectrumHeaderSubscription;

		if (result != null && result.height != null) {
			chainTipHeight = Number(result.height);
		}
		return { chainTipHeight: chainTipHeight };
	}
}

export default LocalIndexerWrapper;

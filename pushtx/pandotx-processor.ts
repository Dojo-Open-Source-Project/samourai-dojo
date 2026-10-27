/*!
 * pushtx/pandotx-processor.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import * as bitcoin from "bitcoinjs-lib";
import QuickLRU from "quick-lru";
import { RPC } from "soroban-client-nodejs";
import keysFile from "../keys/index.js";
import network from "../lib/bitcoin/network.js";
import {
	createRpcClient,
	type DojoRpcClient,
} from "../lib/bitcoind-rpc/rpc-client.js";
import errors from "../lib/errors.js";
import Logger from "../lib/logger.js";
import util from "../lib/util.js";
import pushTxProcessor from "./pushtx-processor.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * A class processing the push of transactions received through PandoTx
 */
class PandoTxProcessor {
	declare checkProcessTxs: ReturnType<typeof setInterval> | null;
	declare keyPush: string | null | undefined;
	declare keyResults: string | null | undefined;
	declare sorobanRpc: RPC | null;
	declare bitcoinRpc: DojoRpcClient | null;
	declare txsCache: QuickLRU<string, boolean>;
	constructor() {
		this.checkProcessTxs = null;
		this.keyPush = null;
		this.keyResults = null;
		this.sorobanRpc = null;
		this.bitcoinRpc = null;
		this.txsCache = new QuickLRU<string, boolean>({
			maxSize: 100,
			maxAge: 1000 * 60 * 60, // one hour
		});

		// Check if processor is active
		if (keys.pandoTx?.process === "active") {
			this.keyPush = keys.pandoTx?.keyPush;
			this.keyResults = keys.pandoTx?.keyResults;

			const sorobanUrl = keys.soroban?.rpc;
			if (typeof sorobanUrl !== "string") {
				throw new Error("Missing Soroban RPC URL");
			}
			const socks5ProxyUrl = sorobanUrl.includes(".onion")
				? keys.soroban?.socks5Proxy
				: null;
			this.sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl);
			this.bitcoinRpc = createRpcClient();
		}
	}

	/**
	 * Start the processor
	 */
	start(): void {
		if (keys.pandoTx?.process === "active") {
			Logger.info("PandoTx : Processor started");

			this.checkProcessTxs = setInterval(() => this.processTxs(), 500);
		} else {
			Logger.info("PandoTx : Processor is inactive");
		}
	}

	/**
	 * Stop the processor
	 */
	stop(): void {
		this.checkProcessTxs && clearInterval(this.checkProcessTxs);
	}

	/**
	 * Process the transactions received through PandoTx
	 */
	async processTxs(): Promise<void> {
		// Check if processor is active
		if (
			keys.pandoTx?.process === "active" &&
			this.sorobanRpc != null &&
			this.bitcoinRpc != null
		) {
			const entries = await this.sorobanRpc.directoryList(this.keyPush);

			await util.parallelCall(entries, async (rawTx) => {
				// Attempt to parse incoming string
				// as a bitcoin transaction in hex format
				let tx = null;
				try {
					tx = bitcoin.Transaction.fromHex(rawTx);
				} catch (error) {
					Logger.error(
						error,
						`PandoTx : Error while parsing transaction ${rawTx}`,
					);
					throw errors.tx.PARSE;
				}
				// Get the TXID of the transaction
				const txid = tx.getId();
				// Check if transaction has already been processed
				if (this.txsCache.has(txid)) {
					return;
				}
				// Check if transaction is known by the node
				try {
					await this.bitcoinRpc.getrawtransaction({ txid, verbose: false });
					return;
				} catch {
					// Transaction not found in mempool
					// We can proceed further
				}
				// Push the transaction to bitcoind
				await pushTxProcessor.pushTx(rawTx, true);
				this.txsCache.set(txid, true);
				// Notify successfull push
				await this.sorobanRpc.directoryAdd(this.keyResults, txid, "short");
			});
		}
	}
}

export default PandoTxProcessor;

/*!
 * pushtx/pushtx-processor.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import * as bitcoin from "bitcoinjs-lib";
import type { Socket as ZmqSocket } from "zeromq/v5-compat.js";
import zmq from "zeromq/v5-compat.js";
import keysFile from "../keys/index.js";
import addrHelper from "../lib/bitcoin/addresses-helper.js";
import network from "../lib/bitcoin/network.js";
import {
	createRpcClient,
	type DojoRpcClient,
} from "../lib/bitcoind-rpc/rpc-client.js";
import db from "../lib/db/mysql-db-wrapper.js";
import errors from "../lib/errors.js";
import Logger from "../lib/logger.js";
import type SourcesBase from "../lib/remote-importer/sources.js";
import PandoTxEmitter from "./pandotx-emitter.js";
import status from "./status.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

const SourcesFile =
	network.key === "bitcoin"
		? await import("../lib/remote-importer/sources-mainnet.js")
		: await import("../lib/remote-importer/sources-testnet.js");

const Sources = SourcesFile.default;

interface PushTxNotificationsConfig {
	uriSocket: string;
}

const errorMessage = (error: unknown): unknown =>
	error instanceof Error ? error.message : error;

/**
 * A singleton providing a wrapper
 * for pushing transactions with the local bitcoind
 */
class PushTxProcessor {
	declare notifSock: ZmqSocket | null;
	declare sources: SourcesBase;
	declare rpcClient: DojoRpcClient;
	declare pandoTxEmitter: PandoTxEmitter | null;
	constructor() {
		this.notifSock = null;
		this.sources = new Sources();
		// Initialize the bitcoind rpc client
		this.rpcClient = createRpcClient();
		this.pandoTxEmitter = null;
		// Initialize the PandoTxEmitter
		if (keys.pandoTx?.push === "active") {
			this.pandoTxEmitter = new PandoTxEmitter(this.rpcClient);
		}
	}

	/**
	 * Start the processor
	 */
	start(): void {
		if (keys.pandoTx?.push === "active") {
			this.pandoTxEmitter?.start();
		}
	}

	/**
	 * Stop the processor
	 */
	async stop(): Promise<void> {
		if (keys.pandoTx?.push === "active") {
			return this.pandoTxEmitter?.stop();
		}
	}

	/**
	 * Initialize the sockets for notifications
	 */
	initNotifications(config: PushTxNotificationsConfig): void {
		// Notification socket for the tracker
		this.notifSock = zmq.socket("pub");
		this.notifSock.bind(config.uriSocket);
	}

	/**
	 * Enforce a strict verification mode on a list of outputs
	 */
	async enforceStrictModeVouts(
		rawtx: string,
		vouts: number[],
	): Promise<number[]> {
		/** @type {number[]} */
		const faultyOutputs: number[] = [];
		/** @type {Map<string, number>} */
		const addrMap = new Map<string, number>();

		let tx: bitcoin.Transaction;
		try {
			tx = bitcoin.Transaction.fromHex(rawtx);
		} catch {
			throw errors.tx.PARSE;
		}
		// Check in db if addresses are known and have been used
		// Check if TX contains outputs to duplicate address
		for (const vout of vouts) {
			if (vout >= tx.outs.length) throw errors.txout.VOUT;
			const output = tx.outs[vout];
			const address = addrHelper.outputScript2Address(output.script);

			if (address) {
				const nbTxs = await db.getAddressNbTransactions(address);
				if (nbTxs == null || nbTxs > 0 || addrMap.has(address)) {
					faultyOutputs.push(vout);
				} else {
					addrMap.set(address, vout);
				}
			}
		}

		// Checks with indexer if addresses are known and have been used
		if (addrMap.size > 0 && keys.indexer.active !== "local_bitcoind") {
			const results = await this.sources.getAddresses([...addrMap.keys()]);

			for (const r of results) {
				if (r.ntx > 0) {
					const vout = addrMap.get(r.address);
					if (vout !== undefined) faultyOutputs.push(vout);
				}
			}
		}
		return faultyOutputs;
	}

	/**
	 * Push transactions to the Bitcoin network
	 */
	async pushTx(rawtx: string, forceLocalPush = false): Promise<string> {
		let value = 0;
		let txid: string | null = null;

		// Attempt to parse incoming TX hex as a bitcoin Transaction
		try {
			const tx = bitcoin.Transaction.fromHex(rawtx);
			txid = tx.getId();
			for (const output of tx.outs) value += output.value;
			Logger.info(`PushTx : Push for ${(value / 1e8).toFixed(8)} BTC`);
		} catch {
			throw errors.tx.PARSE;
		}

		// check if transaction is already in the mempool/blockchain
		try {
			const present = await this.rpcClient.getrawtransaction({
				txid: txid,
				verbose: false,
			});
			if (present) {
				Logger.info("PushTx : Transaction already in mempool/blockchain");
				return txid;
			}
		} catch {
			// continue
		}

		// At this point, the raw hex parses as a legitimate transaction.
		try {
			let processLocalPush = true;
			// Attempt to send via PandoTx (Soroban)
			if (keys.pandoTx?.push === "active" && !forceLocalPush) {
				try {
					const emittedTxid = await this.pandoTxEmitter?.emit(rawtx);
					if (emittedTxid == null)
						throw new Error("PandoTx did not return a txid");
					txid = emittedTxid;
					Logger.info("PandoTx : Pushed!");
					processLocalPush = false;
				} catch (error) {
					Logger.error(errorMessage(error), "PandoTx : ");
					if (keys.pandoTx?.fallbackMode === "secure") {
						processLocalPush = false;
					}
				}
			}
			// Attempt to send via RPC to the bitcoind instance
			if (processLocalPush) {
				txid = await this.rpcClient.sendrawtransaction({ hexstring: rawtx });
				Logger.info("PushTx : Pushed!");
			}
			// Update the stats
			status.updateStats(value);
			// Notify the tracker
			this.notifSock?.send(["pushtx", rawtx]);
			if (txid == null) throw new Error("PushTx did not return a txid");
			return txid;
		} catch (error) {
			Logger.info("PushTx : Push failed");
			throw error;
		}
	}
}

export default new PushTxProcessor();

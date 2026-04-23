/*!
 * pushtx/orchestrator.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { Sema } from "async-sema";
import zmq from "zeromq/v5-compat.js";
import keysFile from "../keys/index.js";
import network from "../lib/bitcoin/network.js";
import {
	createRpcClient,
	isConnectionError,
} from "../lib/bitcoind-rpc/rpc-client.js";
import db from "../lib/db/mysql-db-wrapper.js";
import Logger from "../lib/logger.js";
import pushTxProcessor from "./pushtx-processor.js";

const keys = keysFile[network.key];

/**
 * A class orchestrating the push of scheduled transactions
 */
class Orchestrator {
	constructor() {
		// RPC client
		this.rpcClient = createRpcClient();
		// ZeroMQ socket for bitcoind blocks messages
		this.blkSock = null;
		// Initialize a semaphor protecting the onBlockHash() method
		this._onBlockHashSemaphor = new Sema(1, { capacity: 50 });
	}

	/**
	 * Start processing the blockchain
	 * @returns {Promise}
	 */
	start() {
		this.initSockets();
	}

	/**
	 * Start processing the blockchain
	 */
	async stop() {}

	/**
	 * Initialiaze ZMQ sockets
	 */
	initSockets() {
		// Socket listening to bitcoind Blocks messages
		this.blkSock = zmq.socket("sub");
		this.blkSock.connect(keys.bitcoind.zmqBlk);
		this.blkSock.subscribe("hashblock");

		this.blkSock.on("message", (topic, message) => {
			switch (topic.toString()) {
				case "hashblock":
					this.onBlockHash(message);
					break;
				default:
					Logger.info(`Orchestrator : ${topic.toString()}`);
			}
		});

		Logger.info("Orchestrator : Listening for blocks");
	}

	/**
	 * Push Transactions if triggered by new block
	 * @param {Buffer} buf - block hash
	 */
	async onBlockHash(buf) {
		try {
			// Acquire the semaphor
			await this._onBlockHashSemaphor.acquire();

			// Retrieve the block height
			const blockHash = buf.toString("hex");
			const header = await this.rpcClient.getblockheader({
				blockhash: blockHash,
				verbose: true,
			});
			const height = header.height;

			Logger.info(`Orchestrator : Block ${height} ${blockHash}`);

			let nbTxsPushed;
			let rpcConnOk = true;

			do {
				nbTxsPushed = 0;

				// Retrieve the transactions triggered by this block
				const txs = await db.getActivatedScheduledTransactions(height);
				if (!(txs && txs.length > 0)) break;

				for (const tx of txs) {
					const hasParentTx =
						tx.schParentTxid != null && tx.schParentTxid !== "";
					let parentTx = null;

					// Check if previous transaction has been confirmed
					if (hasParentTx) {
						try {
							parentTx = await this.rpcClient.getrawtransaction({
								txid: tx.schParentTxid,
								verbose: true,
							});
						} catch (error) {
							Logger.error(
								error,
								"Orchestrator : Transaction.getTransaction()",
							);
						}
					}

					if (
						!hasParentTx ||
						(parentTx?.confirmations && parentTx.confirmations >= tx.schDelay)
					) {
						// Push the transaction
						try {
							await pushTxProcessor.pushTx(tx.schRaw);
							Logger.info(
								`Orchestrator : Pushed scheduled transaction ${tx.schTxid}`,
							);
						} catch (error) {
							const message =
								"A problem was met while trying to push a scheduled transaction";
							Logger.error(
								error,
								`Orchestrator : Orchestrator.onBlockHash() : ${message}`,
							);
							// Check if it's an issue with the connection to the RPC API
							// (=> immediately stop the loop)
							if (isConnectionError(error)) {
								Logger.info("Orchestrator : Connection issue");
								rpcConnOk = false;
								break;
							}
						}

						// Update triggers of next transactions if needed
						if (tx.schTrigger < height) {
							const shift = height - tx.schTrigger;
							try {
								await this.updateTriggers(tx.schID, shift);
							} catch (error) {
								const message =
									"A problem was met while shifting scheduled transactions";
								Logger.error(
									error,
									`Orchestrator : Orchestrator.onBlockHash() : ${message}`,
								);
							}
						}

						// Delete the transaction
						try {
							await db.deleteScheduledTransaction(tx.schTxid);
							// Count the transaction as successfully processed
							nbTxsPushed++;
						} catch (error) {
							const message =
								"A problem was met while trying to delete a scheduled transaction";
							Logger.error(
								error,
								`Orchestrator : Orchestrator.onBlockHash() : ${message}`,
							);
						}
					}
				}
			} while (rpcConnOk && nbTxsPushed > 0);
		} catch (error) {
			Logger.error(error, "Orchestrator : Orchestrator.onBlockHash() : Error");
		} finally {
			// Release the semaphor
			await this._onBlockHashSemaphor.release();
		}
	}

	/**
	 * Update triggers in chain of transactions
	 * following a transaction identified by its txid
	 * @param {number} parentId - parent id
	 * @param {number} shift - delta to be added to the triggers
	 */
	async updateTriggers(parentId, shift) {
		if (shift === 0) return;

		const txs = await db.getNextScheduledTransactions(parentId);

		for (const tx of txs) {
			// Update the trigger of the transaction
			const newTrigger = tx.schTrigger + shift;
			await db.updateTriggerScheduledTransaction(tx.schID, newTrigger);
			// Update the triggers of next transactions in the chain
			await this.updateTriggers(tx.schID, shift);
			Logger.info(
				`Orchestrator : Rescheduled tx ${tx.schTxid} (trigger=${newTrigger})`,
			);
		}
	}
}

export default Orchestrator;

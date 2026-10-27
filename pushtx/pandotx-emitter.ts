/*!
 * pushtx/pandotx-emitter.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import * as bitcoin from "bitcoinjs-lib";
import { RPC, RPCCallError } from "soroban-client-nodejs";
import keysFile from "../keys/index.js";
import network from "../lib/bitcoin/network.js";
import type { DojoRpcClient } from "../lib/bitcoind-rpc/rpc-client.js";
import errors from "../lib/errors.js";
import Logger from "../lib/logger.js";
import util from "../lib/util.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

interface WatchdogEntry {
	tx: string;
	txid: string;
	node: string;
	ts: number;
}

type JsonRecord = Record<string, unknown>;

const isJsonRecord = (value: unknown): value is JsonRecord =>
	value != null && typeof value === "object" && !Array.isArray(value);

const announcementUrl = (message: string): string | null => {
	const parsed: unknown = JSON.parse(message);
	if (!isJsonRecord(parsed) || typeof parsed.url !== "string") return null;
	return parsed.url;
};

/**
 * A class processing the push of transactions over Soroban
 */
class PandoTxEmitter {
	declare rpcClient: DojoRpcClient;
	declare keyPush: string | null | undefined;
	declare keyResults: string | null | undefined;
	declare keyAnnounce: string | null | undefined;
	declare keySocks5Proxy: string | null | undefined;
	declare maxNbAttempts: number;
	declare fallbackMode: string | null | undefined;
	declare sorobanRpc: RPC | null;
	declare isWatchdogActive: boolean;
	declare watchdogTxsList: WatchdogEntry[];
	declare watchdogBlacklist: Map<string, number>;
	declare watchdogLoop: ReturnType<typeof setInterval> | null;
	constructor(rpcClient: DojoRpcClient) {
		this.rpcClient = rpcClient;
		this.keyPush = null;
		this.keyResults = null;
		this.keyAnnounce = null;
		this.keySocks5Proxy = null;
		this.maxNbAttempts = 1;
		this.fallbackMode = null;
		this.sorobanRpc = null;
		this.isWatchdogActive = false;
		this.watchdogTxsList = [];
		this.watchdogBlacklist = new Map();
		this.watchdogLoop = null;
		// Check if PandoTx is active
		if (keys.pandoTx?.push === "active") {
			// Retrieve a few useful keys
			this.keyPush = keys.pandoTx?.keyPush;
			this.keyResults = keys.pandoTx?.keyResults;
			this.keyAnnounce = keys.soroban?.keyAnnounce;
			this.keySocks5Proxy = keys.soroban?.socks5Proxy;
			this.maxNbAttempts = (keys.pandoTx?.nbRetries ?? 0) + 1;
			this.fallbackMode = keys.pandoTx?.fallbackMode;
			// Initialize a Soroban RPC client
			const sorobanUrl = keys.soroban?.rpc;
			if (typeof sorobanUrl !== "string") {
				throw new Error("Missing Soroban RPC URL");
			}
			const socks5ProxyUrl = sorobanUrl.includes(".onion")
				? this.keySocks5Proxy
				: null;
			this.sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl);
		}
	}

	/**
	 * Start the emitter
	 */
	start(): void {
		// Start the watchdog loop
		this.watchdogLoop = setInterval(() => this.processWatchdog(), 10000);
	}

	/**
	 * Stop the emitter
	 */
	async stop(): Promise<void> {
		// Process the watchdog one more time
		await this.processWatchdog();
		// Stop the watchdog loop
		if (this.watchdogLoop != null) clearInterval(this.watchdogLoop);
	}

	/**
	 * Push transactions to the Bitcoin network through Soroban PandoTx
	 */
	async emit(rawtx: string, retry = false): Promise<string | undefined> {
		// Check if PandoTx is active
		if (keys.pandoTx?.push === "active" && this.sorobanRpc != null) {
			// Computes the txid of the transaction
			let txid: string | null = null;
			try {
				const tx = bitcoin.Transaction.fromHex(rawtx);
				txid = tx.getId();
			} catch {
				throw errors.tx.PARSE;
			}

			// Prepare an array of remote Soroban node urls
			let url: string | null = null;
			const remoteNodes = await this.sorobanRpc.directoryList(this.keyAnnounce);
			if (remoteNodes == null || remoteNodes.length === 0)
				throw new Error("No available Soroban node found");
			// Extract the urls from the announcement messages
			let urls = remoteNodes
				.map((node) => announcementUrl(node))
				.filter((node): node is string => node !== null);
			// Remove duplicate urls
			urls = [...new Set(urls)];

			// We will try a few times in case of failure
			let counter = this.maxNbAttempts;

			while (counter > 0) {
				// Select a random 'honest' Soroban node
				while (url == null) {
					if (urls.length === 0)
						throw new Error("No available Soroban node found");

					// Select a random url
					const idx = Math.floor(Math.random() * urls.length);
					url = urls[idx];
					if (url == null) continue;

					if (this.watchdogBlacklist.has(url)) {
						// Check if blacklisting has expired (>24h)
						const blacklistedAt = this.watchdogBlacklist.get(url) ?? 0;
						const delta = Date.now() - blacklistedAt;
						if (delta < 86400000) {
							urls.splice(idx, 1);
							url = null;
						} else {
							this.watchdogBlacklist.delete(url);
						}
					}
				}

				counter--;

				// Push the transaction over PandoTx
				let addedToDirectory = true;
				try {
					// Last attempt: push on local soroban node
					if (counter === 0 && this.fallbackMode !== "secure") {
						// Local push
						await this.sorobanRpc.directoryAdd(this.keyPush, rawtx, "fast");
					} else {
						// Remote push
						const sorobanPushClient = new RPC(
							`${url}/rpc`,
							this.keySocks5Proxy,
						);
						await sorobanPushClient.directoryAdd(this.keyPush, rawtx, "fast");
					}
				} catch (error) {
					if (error instanceof RPCCallError) {
						if (error.message.includes("Socks5 proxy rejected connection")) {
							// Blacklist the soroban node
							this.watchdogBlacklist.set(url, Date.now());
							Logger.info(
								`PandoTx : Blacklisted Soroban node ${url} (not responding)`,
							);
						} else if (error.message.includes("Proxy connection timed out")) {
							// Blacklist the soroban node
							this.watchdogBlacklist.set(url, Date.now());
							Logger.info(
								`PandoTx : Blacklisted Soroban node ${url} (connection timeout)`,
							);
						}
					}
					addedToDirectory = false;
				}

				if (!addedToDirectory) continue;

				// Wait for a confirmation
				const t0 = Date.now();
				while (true) {
					const confirmations = await this.sorobanRpc.directoryList(
						this.keyResults,
					);
					// Check if txid found in confirmations
					if (confirmations != null && confirmations.length > 0) {
						for (const confirmation of confirmations) {
							if (confirmation === txid) {
								// Add an entry to watchdogTxsList
								this.watchdogTxsList.push({
									tx: rawtx,
									txid: txid,
									node: url,
									ts: Date.now(),
								});
								Logger.info(
									`PandoTx : Successfully pushed tx ${txid} through Soroban node ${url}`,
								);
								return txid;
							}
						}
					}
					// Return a failure if no response received after 15s
					const t1 = Date.now();
					if (t1 - t0 > 15000) {
						this.watchdogBlacklist.set(url, Date.now());
						Logger.info(`PandoTx : Blacklisted Soroban node ${url} (timeout)`);
						if (retry) {
							return await this.emit(rawtx, retry);
						} else {
							throw new Error(
								`Timeout: Failed to push tx ${txid} through Soroban node ${url} in less than 15s`,
							);
						}
					}
					// Pause
					await util.delay(500);
				}
			}
			// Failed to push the transaction after a given number of attempts
			throw new Error(
				`Failed to push tx ${txid} through Soroban after ${this.maxNbAttempts} attempts`,
			);
		}
	}

	/**
	 * Run a watchdog checking that pushed transactions are seen by the local bitcoind
	 * Manages a blacklist of malicious Soroban nodes
	 */
	async processWatchdog(): Promise<void> {
		// Prevent multiple watchdogs at the same time (for long processings)
		if (this.isWatchdogActive) {
			return;
		}

		try {
			this.isWatchdogActive = true;
			for (let i = this.watchdogTxsList.length - 1; i >= 0; i--) {
				const entry = this.watchdogTxsList[i];
				if (entry == null) continue;
				const now = Date.now();
				if (now - entry.ts >= 30000) {
					// Check if transaction is known by local bitcoind after 30s
					const txid = entry.txid;
					try {
						await this.rpcClient.getrawtransaction({
							txid,
							verbose: false,
						});
						// Remove the transaction from the list
						this.watchdogTxsList.splice(i, 1);
					} catch {
						// Blacklist the faulty soroban node
						this.watchdogBlacklist.set(entry.node, Date.now());
						Logger.info(
							`PandoTx : Blacklisted misbehaving Soroban node ${entry.node}`,
						);
						// Remove the transaction from the list
						this.watchdogTxsList.splice(i, 1);
						// Emit the transaction again
						Logger.info(
							`PandoTx : Transaction ${txid} not seen by local bitcoind after 30s. A new emission is going to be processed.`,
						);
						await this.emit(entry.tx, true);
					}
				}
			}
		} finally {
			this.isWatchdogActive = false;
		}
	}
}

export default PandoTxEmitter;

/*!
 * lib/remote-importer/remote-importer.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../../keys/index.js";
import hdaHelper from "../bitcoin/hd-accounts-helper.js";
import network from "../bitcoin/network.js";
import rpcTxns, {
	type PreparedInput,
	type PreparedTransaction,
} from "../bitcoind-rpc/transactions.js";
import db from "../db/mysql-db-wrapper.js";
import errors from "../errors.js";
import Logger from "../logger.js";
import util from "../util.js";
import type SourcesBase from "./sources.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;
const gap = keys.gap;

const SourcesFile =
	network.key === "bitcoin"
		? await import("./sources-mainnet.js")
		: await import("./sources-testnet.js");

const Sources = SourcesFile.default as new () => SourcesBase;

export interface ImportState {
	status?: string;
	txs_ext?: number;
	txs_int?: number;
	txs?: number;
}

interface ImportAddress {
	address: string;
	chain: number;
	index: number;
}

interface ScanResult {
	addresses: ImportAddress[];
	transactions: PreparedTransaction[];
}

/**
 * A singleton providing tools
 * for importing HD and loose addresses from remote sources
 */
class RemoteImporter {
	declare STATUS_RESCAN: string;
	declare STATUS_IMPORT: string;
	private readonly importing = new Map<string, ImportState | true>();
	declare sources: SourcesBase;
	constructor() {
		this.STATUS_RESCAN = "rescan";
		this.STATUS_IMPORT = "import";
		this.sources = new Sources();
	}

	private claimImport(key: string, state: ImportState | true): boolean {
		if (this.importing.has(key)) return false;
		// All imports run in Accounts; claim before yielding to another request.
		this.importing.set(key, state);
		return true;
	}

	importInProgress(xpub?: string): ImportState | true | null {
		if (xpub == null) return null;
		return this.importing.get(xpub) ?? null;
	}

	/**
	 * Import an HD account from remote sources
	 */
	async importHDAccount(
		xpub?: string,
		type?: number,
		gapLimit?: number,
		startIndex?: number,
	) {
		if (!hdaHelper.isValid(xpub)) throw errors.xpub.INVALID;

		if (
			!this.claimImport(xpub, {
				status: this.STATUS_RESCAN,
				txs_ext: 0,
				txs_int: 0,
			})
		) {
			Logger.info(`Importer : Import overlap for ${xpub}`);
			throw errors.xpub.OVERLAP;
		}

		const t0 = Date.now();
		try {
			const ts = hdaHelper.typeString(type);
			Logger.info(`Importer : Importing ${xpub} ${ts}`);

			// Allow custom higher gap limits
			// for local scans relying on bitcoind or on a local indexer
			const isLocal = ["local_bitcoind", "local_indexer"].includes(
				keys.indexer.active,
			);
			const gaps =
				gapLimit && isLocal
					? [gapLimit, gapLimit]
					: [gap.external, gap.internal];

			startIndex = startIndex == null ? -1 : startIndex - 1;

			// Call in series
			const results = [
				await this.xpubScan(xpub, 0, startIndex, startIndex, gaps[0], type), // external chain
				await this.xpubScan(xpub, 1, startIndex, startIndex, gaps[1], type), // internal chain
			];

			// Accumulate addresses and transactions from all chains
			const txns = results.flatMap((r) => r.transactions);
			const addresses = results.flatMap((r) => r.addresses);
			const aAddresses = addresses.map((a) => a.address);

			this.importing.set(xpub, {
				status: this.STATUS_IMPORT,
				txs: txns.length,
			});

			// Store the hdaccount and the addresses into the database
			await db.ensureHDAccountId(xpub, type);

			const addrChunks = util.splitList(addresses, 1000);
			await util.seriesCall(addrChunks, (chunk) => {
				return db.addAddressesToHDAccount(xpub, chunk);
			});

			// Store the transaction into the database
			await this._importTransactions(aAddresses, txns);
		} catch (error) {
			Logger.error(
				error,
				`Importer : RemoteImporter.importHDAccount() : xpub ${xpub}`,
			);
		} finally {
			Logger.info(
				`Importer :  xpub import done in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
			);
			this.importing.delete(xpub);
		}

		return true;
	}

	/**
	 * Recursive scan of xpub addresses & transactions
	 *
	 * 0. HD chain       c on [0,1]
	 *    Gap limit      G
	 *    Last derived   d = -1
	 *    Last used      u = -1
	 * 1. Derive addresses M/c/{A}, with A on [d+1, u+G], set d = u + G
	 * 2. Look up transactions T for M/c/{A} from remote
	 * 3. If |T| = 0, go to 5
	 * 4. Set u = highest chain index of used address, go to 1
	 * 5. Store all in database
	 */
	async xpubScan(
		xpub?: string,
		c = 0,
		d = -1,
		u = -1,
		G = 0,
		type?: number,
		txids: Record<string, true> = {},
	): Promise<ScanResult> {
		const returnValue: ScanResult = {
			addresses: [],
			transactions: [],
		};

		// Check that next derived isn't after last used + gap limit
		if (d + 1 > u + G) return returnValue;

		// Derive the required number of new addresses
		const A = util.range(d + 1, u + G + 1);
		returnValue.addresses = await hdaHelper.deriveAddresses(xpub, c, A, type);

		// Update derived index
		d = u + G;
		Logger.info(`Importer :  derived M/${c}/${A.join(",")}`);

		const addrMap = returnValue.addresses.reduce(
			(m, a) => {
				m[a.address] = a;
				return m;
			},
			{} as Record<string, ImportAddress>,
		);
		const aAddresses = returnValue.addresses.map((a) => a.address);

		try {
			const results = await this.sources.getAddresses(aAddresses);
			const filteredResults = results.flat().filter((r) => r.ntx > 0);
			const gotTransactions = filteredResults.length > 0;
			const scanTx = filteredResults
				.flatMap((r) => r.txids)
				.filter((t) => !txids[t]);
			u = filteredResults.reduce(
				(m, r) => Math.max(m, addrMap[r.address].index),
				u,
			);

			Logger.info(`Importer :  Got ${scanTx.length} transactions`);

			// Retrieve the transactions by batches of 200 transactions
			try {
				const txsChunks = util.splitList(scanTx, 200);
				const txs = await util.seriesCall(txsChunks, (chunk) => {
					return rpcTxns.getTransactions(chunk, false);
				});
				const filteredTxs = txs
					.flat()
					.filter((tx): tx is PreparedTransaction => tx != null);
				returnValue.transactions = [
					...returnValue.transactions,
					...filteredTxs,
				];
				txids = filteredTxs.reduce((m, tx) => {
					m[tx.txid] = true;
					return m;
				}, txids);
			} catch (error) {
				Logger.error(
					error,
					"Importer : RemoteImporter.xpubScan() : getTransactions error",
				);
			}

			if (gotTransactions) {
				const keyStatus = c === 0 ? "txs_ext" : "txs_int";
				const importState = this.importing.get(xpub);
				if (typeof importState === "object")
					importState[keyStatus] = Object.keys(txids).length;
				// We must go deeper
				const result = await this.xpubScan(xpub, c, d, u, G, type, txids);
				// Accumulate results from further down the rabbit hole
				returnValue.addresses = [...returnValue.addresses, ...result.addresses];
				returnValue.transactions = [
					...returnValue.transactions,
					...result.transactions,
				];
			}
		} catch (error) {
			Logger.error(
				error,
				`Importer : RemoteImporter.xpubScan() : xpub ${xpub} ${c} ${d} ${u} ${G}`,
			);
		}

		return returnValue;
	}

	/**
	 * Import a list of addresses
	 */
	async importAddresses(candidates: string[] = [], filterAddr?: boolean) {
		const t0 = Date.now();

		const addresses: string[] = [];
		try {
			for (const address of new Set(candidates)) {
				if (this.claimImport(address, true)) addresses.push(address);
				else Logger.info(`Importer : Import overlap for ${address}. Skipping`);
			}
			if (addresses.length === 0) return true;
			Logger.info(`Importer : Importing ${addresses.join(",")}`);
			const results = await this.sources.getAddresses(addresses, filterAddr);
			const imported = results.map((r) => r.address);
			const filteredResults = results.filter((r) => r.ntx > 0);
			const scanTx = [...new Set(filteredResults.flatMap((r) => r.txids))];

			Logger.info(`Importer :  Got ${scanTx.length} transactions`);

			// Retrieve the transactions by batches of 100 transactions
			const txsChunks = util.splitList(scanTx, 100);
			const txs = await util.seriesCall(txsChunks, (chunk) => {
				return rpcTxns.getTransactions(chunk, false);
			});
			const txns = txs
				.flat()
				.filter((tx): tx is PreparedTransaction => tx != null);

			// Import addresses and transactions into the database
			await db.addAddresses(imported);
			await this._importTransactions(addresses, txns);
		} catch (error) {
			Logger.error(
				error,
				`Importer : RemoteImporter.importAddresses() : ${candidates.join(",")}`,
			);
		} finally {
			const dt = Date.now() - t0;
			const ts = (dt / 1000).toFixed(1);
			const N = addresses.length;

			if (N > 0)
				Logger.info(
					`Importer : Imported ${N} addresses in ${ts}s (${(dt / N).toFixed(0)} ms/addr)`,
				);

			for (const address of addresses) this.importing.delete(address);
		}

		return true;
	}

	/**
	 * Import a list of transactions associated to a list of addresses
	 */
	async _importTransactions(addresses: string[], txs: PreparedTransaction[]) {
		const addrChunks = util.splitList(addresses, 1000);
		const addrIdMaps = await util.seriesCall(addrChunks, (chunk) => {
			return db.getAddressesIds(chunk);
		});
		const addrIdMap = Object.assign(
			{} as Record<string, number>,
			...addrIdMaps,
		);

		// Process the transactions by batches of 200 transactions
		const txsChunks = util.splitList(txs, 200);
		await util.seriesCall(txsChunks, (chunk) => {
			return this._addTransactions(chunk);
		});
		await util.seriesCall(txsChunks, (chunk) => {
			return this._addOutputs(chunk, addrIdMap);
		});
		await util.seriesCall(txsChunks, (chunk) => {
			return this._addInputs(chunk);
		});
	}

	/**
	 * Add a collection of transactions to the database.
	 */
	async _addTransactions(txs: PreparedTransaction[]) {
		try {
			// Store the transactions into the database
			await db.addTransactions(txs);

			// Confirm the transactions if needed
			const blocksHashes = txs
				.filter((tx) => tx.block)
				.map((tx) => tx.block?.hash)
				.filter((hash): hash is string => hash != null);
			const blocks = await db.getBlocksByHashes(blocksHashes);

			return util.parallelCall(blocks, (block) => {
				const filteredTxs = txs.filter(
					(tx) => tx.block && tx.block.hash === block.blockHash,
				);
				if (filteredTxs.length === 0) return;
				const txids = filteredTxs.map((tx) => tx.txid);
				return db.confirmTransactions(txids, block.blockID);
			});
		} catch (error) {
			Logger.error(error, "Importer : RemoteImporter.addTransactions() :");
		}
	}

	/**
	 * Add a collection of transaction outputs to the database.
	 */
	async _addOutputs(
		txs: PreparedTransaction[],
		addrIdMap: Record<string, number>,
	) {
		try {
			const txids = txs.map((tx) => tx.txid);
			const mapTxsIds = await db.getTransactionsIds(txids);

			const outputs = txs
				.flatMap((tx) =>
					tx.outputs.map((o) => {
						return {
							...o,
							txnID: mapTxsIds[tx.txid],
						};
					}),
				)
				.filter((o) => o.address != null && addrIdMap[o.address])
				.map((o) => {
					return {
						txnID: o.txnID,
						addrID: addrIdMap[o.address ?? ""],
						outIndex: o.n,
						outAmount: o.value,
						outScript: o.scriptpubkey,
					};
				});

			return db.addOutputs(outputs);
		} catch (error) {
			Logger.error(error, "Importer : RemoteImporter._addOutputs() :");
		}
	}

	/**
	 * Add a collection of transaction inputs to the database.
	 */
	async _addInputs(txs: PreparedTransaction[]) {
		try {
			// Retrieve the database ids for the transactions
			const txids = txs.map((tx) => tx.txid);
			const mapTxsIds = await db.getTransactionsIds(txids);

			// Get outputs spent by the inputs of this transaction,
			// add those database outIDs to the corresponding inputs, and store.
			const outpoints = txs
				.flatMap((tx) => tx.inputs)
				.map((input) => input.outpoint)
				.filter(
					(outpoint): outpoint is NonNullable<PreparedInput["outpoint"]> =>
						outpoint != null,
				);
			const res = await db.getOutputIds(outpoints);
			const spent = res.reduce(
				(m, r) => {
					m[`${r.txnTxid}-${r.outIndex}`] = r.outID;
					return m;
				},
				{} as Record<string, number>,
			);

			const inputs = txs
				.flatMap((tx) =>
					tx.inputs.map((input) => ({
						...input,
						txnID: mapTxsIds[tx.txid],
					})),
				)
				.filter(
					(input) =>
						input.outpoint != null &&
						spent[`${input.outpoint.txid}-${input.outpoint.vout}`],
				)
				.map((input) => {
					if (input.outpoint == null) throw errors.generic.GEN;
					return {
						outID: spent[`${input.outpoint.txid}-${input.outpoint.vout}`],
						txnID: input.txnID,
						inIndex: input.n,
						inSequence: input.seq,
					};
				});

			return db.addInputs(inputs);
		} catch (error) {
			Logger.error(error, "Importer : RemoteImporter.addTransactions() :");
		}
	}

	/**
	 * Retrieve the height of the chaintip for the remote source
	 */
	async getChainTipHeight() {
		return this.sources.getChainTipHeight();
	}
}

export default new RemoteImporter();

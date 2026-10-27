/*!
 * lib/bitcoind-rpc/transactions.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import QuickLRU from "quick-lru";

import errors from "../errors.js";
import Logger from "../logger.js";
import util from "../util.js";
import rpcLatestBlock from "./latest-block.js";
import { createRpcClient, type DojoRpcClient } from "./rpc-client.js";

interface RpcInput {
	sequence: number;
	coinbase?: string;
	txid?: string;
	vout?: number;
	scriptSig?: {
		hex: string;
	};
	txinwitness?: string[];
}

interface RpcOutput {
	value: number;
	scriptPubKey: {
		hex: string;
		type: string;
		address?: string;
	};
}

interface RpcTransaction {
	txid: string;
	size: number;
	version: number;
	locktime: number;
	vin: RpcInput[];
	vout: RpcOutput[];
	vsize?: number;
	time?: number;
	confirmations?: number;
	blockhash?: string;
	blocktime?: number;
	hex?: string;
}

export interface PreparedInput {
	n: number;
	seq: number;
	coinbase?: string;
	outpoint?: {
		txid: string;
		vout: number;
		value?: number;
		scriptpubkey?: string;
	};
	sig?: string;
	witness?: string[];
}

export interface PreparedOutput {
	n: number;
	value: number;
	scriptpubkey: string;
	type: string;
	address?: string;
}

export interface PreparedTransaction {
	txid: string;
	size: number;
	version: number;
	locktime: number;
	inputs: PreparedInput[];
	outputs: PreparedOutput[];
	vsize?: number;
	created?: number;
	confirmations?: number;
	block?: {
		height: number;
		hash: string;
		time: number;
	};
	fees?: number;
	feerate?: number;
	vfeerate?: number;
	hex?: string;
}

interface PrepareOptions {
	fees?: boolean;
	rawHex?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value != null && typeof value === "object";

const isRpcTransaction = (value: unknown): value is RpcTransaction => {
	if (!isRecord(value)) return false;
	return (
		typeof value.txid === "string" &&
		typeof value.size === "number" &&
		typeof value.version === "number" &&
		typeof value.locktime === "number" &&
		Array.isArray(value.vin) &&
		Array.isArray(value.vout)
	);
};

/**
 * A singleton providing information about transactions
 */
class Transactions {
	declare prevCache: QuickLRU<string, RpcTransaction>;
	declare rpcClient: DojoRpcClient;
	constructor() {
		// Caches
		this.prevCache = new QuickLRU({
			// Maximum number of transactions to store
			maxSize: 20000,
			// Maximum age for items in the cache.
			maxAge: 1000 * 60 * 60 * 24 * 2, // two days
		});

		// Initialize the rpc client
		this.rpcClient = createRpcClient();
	}

	/**
	 * Get the transactions for a given array of txids
	 */
	async getTransactions(txids: string[] = [], fees?: boolean) {
		try {
			const rpcCalls = txids.map((txid, index) => {
				return {
					method: "getrawtransaction",
					params: {
						txid,
						verbose: true,
					},
					id: index,
				};
			});

			const txs = await this.rpcClient.batch(rpcCalls);

			return await util.parallelCall(txs, async (tx) => {
				if (!("result" in tx) || tx.result == null) {
					Logger.info(`Bitcoind RPC :  got null for ${txids[Number(tx.id)]}`);
					return null;
				} else if (!isRpcTransaction(tx.result)) {
					throw errors.generic.GEN;
				} else {
					return this._prepareTxResult(tx.result, { fees });
				}
			});
		} catch (error) {
			Logger.error(error, "Bitcoind RPC : Transaction.getTransactions()");
			throw errors.generic.GEN;
		}
	}

	/**
	 * Get the transaction for a given txid
	 */
	async getTransaction(txid?: string, { fees, rawHex }: PrepareOptions = {}) {
		try {
			if (txid == null) throw errors.generic.GEN;
			const tx = await this.rpcClient.getrawtransaction({
				txid,
				verbose: true,
			});
			if (!isRpcTransaction(tx)) throw errors.generic.GEN;
			return this._prepareTxResult(tx, { fees, rawHex });
		} catch (error) {
			Logger.error(error, "Bitcoind RPC : Transaction.getTransaction()");
			throw errors.generic.GEN;
		}
	}

	/**
	 * Get the raw transaction hex for a given txid
	 */
	async getTransactionHex(txid?: string) {
		try {
			if (txid == null) throw errors.generic.GEN;
			const txHex = await this.rpcClient.getrawtransaction({
				txid,
				verbose: false,
			});
			return txHex;
		} catch (error) {
			Logger.error(error, "Bitcoind RPC : Transaction.getTransactionHex()");
			throw errors.generic.GEN;
		}
	}

	/**
	 * Formats a transaction object returned by the RPC API
	 */
	async _prepareTxResult(
		tx: RpcTransaction,
		{ fees, rawHex }: PrepareOptions = {},
	): Promise<PreparedTransaction> {
		const returnValue: PreparedTransaction = {
			txid: tx.txid,
			size: tx.size,
			version: tx.version,
			locktime: tx.locktime,
			inputs: [],
			outputs: [],
		};

		if (tx.vsize) {
			returnValue.vsize = tx.vsize;
		}

		if (tx.time) {
			returnValue.created = tx.time;
		}

		if (tx.confirmations) {
			returnValue.confirmations = tx.confirmations;
		}

		// Process block informations
		if (tx.blockhash && tx.confirmations && tx.blocktime) {
			returnValue.block = {
				height: (rpcLatestBlock.height ?? 0) - tx.confirmations + 1,
				hash: tx.blockhash,
				time: tx.blocktime,
			};
		}

		let inAmount = 0;
		let outAmount = 0;

		// Process the inputs
		returnValue.inputs = await this._getInputs(tx, fees);
		inAmount = returnValue.inputs.reduce(
			(previous, current) => previous + (current.outpoint?.value ?? 0),
			0,
		);

		// Process the outputs
		returnValue.outputs = this._getOutputs(tx);
		outAmount = returnValue.outputs.reduce(
			(previous, current) => previous + current.value,
			0,
		);

		// Process the fees (if needed)
		if (fees) {
			returnValue.fees = inAmount - outAmount;
			if (returnValue.fees > 0 && returnValue.size > 0)
				returnValue.feerate = Math.round(returnValue.fees / returnValue.size);
			if (returnValue.fees > 0 && returnValue.vsize)
				returnValue.vfeerate = Math.round(returnValue.fees / returnValue.vsize);
		}

		if (rawHex) {
			returnValue.hex = tx.hex;
		}

		return returnValue;
	}

	/**
	 * Extract information about the inputs of a transaction
	 */
	async _getInputs(tx: RpcTransaction, fees?: boolean) {
		const inputs: PreparedInput[] = [];
		let n = 0;

		await util.seriesCall(tx.vin, async (input) => {
			const txin: PreparedInput = {
				n,
				seq: input.sequence,
			};

			if (input.coinbase) {
				txin.coinbase = input.coinbase;
			} else {
				if (input.txid == null || input.vout == null || input.scriptSig == null)
					throw errors.generic.GEN;
				txin.outpoint = {
					txid: input.txid,
					vout: input.vout,
				};
				txin.sig = input.scriptSig.hex;
			}

			if (input.txinwitness) txin.witness = input.txinwitness;

			if (fees && txin.outpoint) {
				const inTxid = txin.outpoint.txid;
				let ptx: RpcTransaction;

				if (this.prevCache.has(inTxid)) {
					ptx = this.prevCache.get(inTxid);
				} else {
					const rpcTx = await this.rpcClient.getrawtransaction({
						txid: inTxid,
						verbose: true,
					});
					if (!isRpcTransaction(rpcTx)) throw errors.generic.GEN;
					ptx = rpcTx;
					this.prevCache.set(inTxid, ptx);
				}

				const outpoint = ptx.vout[txin.outpoint.vout];
				txin.outpoint.value = Math.round(outpoint.value * 1e8);
				txin.outpoint.scriptpubkey = outpoint.scriptPubKey.hex;
				inputs.push(txin);
				n++;
			} else {
				inputs.push(txin);
				n++;
			}
		});

		return inputs;
	}

	/**
	 * Extract information about the outputs of a transaction
	 */
	_getOutputs(tx: RpcTransaction) {
		const outputs: PreparedOutput[] = [];
		let n = 0;

		for (const output of tx.vout) {
			const pk = output.scriptPubKey;
			const amount = Math.round(output.value * 1e8);

			const o: PreparedOutput = {
				n,
				value: amount,
				scriptpubkey: pk.hex,
				type: pk.type,
			};

			if (pk.address) {
				o.address = pk.address;
			}

			outputs.push(o);
			n++;
		}

		return outputs;
	}
}

export default new Transactions();

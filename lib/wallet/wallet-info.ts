/*!
 * lib/wallet/wallet-info.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import addrService from "../bitcoin/addresses-service.js";
import rpcFees from "../bitcoind-rpc/fees.js";
import rpcLatestBlock from "../bitcoind-rpc/latest-block.js";
import type {
	ApiInput,
	ApiOutput,
	ApiTransaction,
} from "../db/mysql-db-wrapper.js";
import db from "../db/mysql-db-wrapper.js";
import util from "../util.js";
import AddressInfo from "./address-info.js";
import HdAccountInfo from "./hd-account-info.js";
import type WalletEntities from "./wallet-entities.js";

interface WalletSummary {
	finalBalance: number;
}

interface WalletInfoMeta {
	fees: Record<number, number> | Record<string, number>;
	estimatorFees: Record<number, number> | null | Record<string, number>;
	latestBlock: {
		height: number | null;
		hash: string | null;
		time: number | null;
	};
}

interface WalletUtxo {
	tx_hash: string;
	tx_output_n: number;
	tx_version: number;
	tx_locktime: number;
	value: number;
	script: string;
	addr: string;
	confirmations: number;
	pubkey?: string;
	xpub?: {
		m: string;
		path: string;
	};
}

type WalletAddress = (AddressInfo | HdAccountInfo) & { pubkey?: string };
type WalletInput = ApiInput & {
	prev_out: ApiInput["prev_out"] & { pubkey?: string };
};
type WalletOutput = ApiOutput & { pubkey?: string };
type WalletTransaction = ApiTransaction & {
	balance?: number;
	inputs: WalletInput[];
	out: WalletOutput[];
	result: number;
};

/**
 * A class storing information about a (full|partial) wallet
 * Provides a set of methods allowing to retrieve specific information
 * @class WalletInfo
 */
class WalletInfo {
	declare entities: WalletEntities;
	declare wallet: WalletSummary;
	declare info: WalletInfoMeta;
	declare addresses: WalletAddress[];
	declare txs: WalletTransaction[];
	declare unspentOutputs: WalletUtxo[];
	declare nTx: number;

	constructor(entities: WalletEntities) {
		// Initializes wallet properties
		this.entities = entities;

		this.wallet = {
			finalBalance: 0,
		};

		this.info = {
			fees: {},
			estimatorFees: {},
			latestBlock: {
				height: rpcLatestBlock.height,
				hash: rpcLatestBlock.hash,
				time: rpcLatestBlock.time,
			},
		};

		this.addresses = [];
		this.txs = [];
		this.unspentOutputs = [];
		this.nTx = 0;
	}

	/**
	 * Ensure hd accounts exist in database
	 */
	async ensureHdAccounts() {
		return util.parallelCall(this.entities.xpubs, async (xpub?: string) => {
			const hdaInfo = new HdAccountInfo(xpub);
			return hdaInfo.ensureHdAccount();
		});
	}

	/**
	 * Load information about the hd accounts
	 */
	async loadHdAccountsInfo() {
		return util.parallelCall(this.entities.xpubs, async (xpub?: string) => {
			const hdaInfo = new HdAccountInfo(xpub);
			await hdaInfo.loadInfo();
			this.wallet.finalBalance += hdaInfo.finalBalance;
			this.addresses.push(hdaInfo);
		});
	}

	/**
	 * Ensure addresses exist in database
	 */
	async ensureAddresses() {
		const importAddrs = [];

		const addrIdMap = await db.getAddressesIds(this.entities.addrs);

		for (const addr of this.entities.addrs) {
			if (!addrIdMap[addr]) importAddrs.push(addr);
		}

		// Import new addresses
		return addrService.restoreAddresses(importAddrs, true);
	}

	/**
	 * Filter addresses that belong to an active hd account
	 */
	async filterAddresses() {
		const res = await db.getXpubByAddresses(this.entities.addrs);

		for (const addr in res) {
			const xpub = res[addr];
			if (this.entities.xpubs.includes(xpub)) {
				const index = this.entities.addrs.indexOf(addr);
				if (index > -1) {
					this.entities.addrs.splice(index, 1);
					this.entities.pubkeys.splice(index, 1);
				}
			}
		}
	}

	/**
	 * Load information about the addresses
	 */
	async loadAddressesInfo() {
		return util.parallelCall(this.entities.addrs, async (address?: string) => {
			const addrInfo = new AddressInfo(address);
			await addrInfo.loadInfo();
			this.wallet.finalBalance += addrInfo.finalBalance;
			this.addresses.push(addrInfo);
		});
	}

	/**
	 * Loads a partial list of transactions for this wallet
	 */
	async loadTransactions(
		page?: number,
		count?: number | null,
		txBalance?: boolean,
	) {
		this.txs = (await db.getTxsByAddrAndXpubs(
			this.entities.addrs,
			this.entities.xpubs,
			page,
			count,
		)) as WalletTransaction[];

		if (txBalance) {
			// Computes wallet balance after each transaction
			let balance = this.wallet.finalBalance;
			for (let index = 0; index < this.txs.length; index++) {
				this.txs[index].balance = balance;
				balance -= this.txs[index].result;
			}
		}
	}

	/**
	 * Loads the number of transactions for this wallet
	 */
	async loadNbTransactions() {
		const nbTxs = await db.getAddrAndXpubsNbTransactions(
			this.entities.addrs,
			this.entities.xpubs,
		);

		if (typeof nbTxs === "number") this.nTx = nbTxs;
	}

	/**
	 * Loads tinfo about the fee rates
	 */
	async loadFeesInfo() {
		this.info.fees = await rpcFees.getFees();

		try {
			this.info.estimatorFees = await rpcFees.getEstimatorFees();
		} catch {
			this.info.estimatorFees = null;
		}
	}

	/**
	 * Loads the list of unspent outputs for this wallet
	 */
	async loadUtxos() {
		// Load the utxos for the hd accounts
		await util.parallelCall(this.entities.xpubs, async (xpub?: string) => {
			const hdaInfo = new HdAccountInfo(xpub);
			const utxos = await hdaInfo.loadUtxos();
			for (const utxo of utxos) this.unspentOutputs.push(utxo);
		});

		// Load the utxos for the addresses
		const utxos = await db.getUnspentOutputs(this.entities.addrs);

		for (const utxo of utxos) {
			const config =
				utxo.blockHeight == null
					? 0
					: (rpcLatestBlock.height ?? 0) - utxo.blockHeight + 1;

			const entry = {
				tx_hash: utxo.txnTxid,
				tx_output_n: utxo.outIndex,
				tx_version: utxo.txnVersion,
				tx_locktime: utxo.txnLocktime,
				value: utxo.outAmount,
				script: utxo.outScript,
				addr: utxo.addrAddress,
				confirmations: config,
			};

			this.unspentOutputs.push(entry);
		}

		// Order the utxos
		this.unspentOutputs.sort((a, b) => b.confirmations - a.confirmations);
	}

	/**
	 * Post process addresses and public keys
	 */
	async postProcessAddresses() {
		for (let b = 0; b < this.entities.pubkeys.length; b++) {
			const pk = this.entities.pubkeys[b];

			if (typeof pk === "string") {
				const address = this.entities.addrs[b];

				// Add pubkeys in this.addresses
				for (let c = 0; c < this.addresses.length; c++) {
					if (address === this.addresses[c].address)
						this.addresses[c].pubkey = pk;
				}

				// Add pubkeys in this.txs
				for (let d = 0; d < this.txs.length; d++) {
					// inputs
					for (let e = 0; e < this.txs[d].inputs.length; e++) {
						if (address === this.txs[d].inputs[e].prev_out.addr)
							this.txs[d].inputs[e].prev_out.pubkey = pk;
					}
					// outputs
					for (let e = 0; e < this.txs[d].out.length; e++) {
						if (address === this.txs[d].out[e].addr)
							this.txs[d].out[e].pubkey = pk;
					}
				}

				// Add pubkeys in this.unspentOutputs
				for (let f = 0; f < this.unspentOutputs.length; f++) {
					if (address === this.unspentOutputs[f].addr) {
						this.unspentOutputs[f].pubkey = pk;
					}
				}
			}
		}
	}

	/**
	 * Post process hd accounts (xpubs translations)
	 */
	async postProcessHdAccounts() {
		for (let b = 0; b < this.entities.xpubs.length; b++) {
			const entityXPub = this.entities.xpubs[b];
			const entityYPub = this.entities.ypubs[b];
			const entityZPub = this.entities.zpubs[b];

			if (entityYPub || entityZPub) {
				const tgtXPub = entityYPub || entityZPub;

				if (typeof tgtXPub !== "string") continue;

				// Translate (xpub?: string) => ypub/zpub in this.addresses
				for (let c = 0; c < this.addresses.length; c++) {
					if (entityXPub === this.addresses[c].address)
						this.addresses[c].address = tgtXPub;
				}

				// Translate (xpub?: string) => ypub/zpub in this.txs
				for (let d = 0; d < this.txs.length; d++) {
					// inputs
					for (let e = 0; e < this.txs[d].inputs.length; e++) {
						const xpub = this.txs[d].inputs[e].prev_out.xpub;
						if (xpub && xpub.m === entityXPub)
							this.txs[d].inputs[e].prev_out.xpub.m = tgtXPub;
					}

					// outputs
					for (let e = 0; e < this.txs[d].out.length; e++) {
						const xpub = this.txs[d].out[e].xpub;
						if (xpub && xpub.m === entityXPub)
							this.txs[d].out[e].xpub.m = tgtXPub;
					}
				}

				// Translate (xpub?: string) => ypub/zpub in this.unspentOutputs
				for (let f = 0; f < this.unspentOutputs.length; f++) {
					const xpub = this.unspentOutputs[f].xpub;
					if (xpub && xpub.m === entityXPub) {
						this.unspentOutputs[f].xpub.m = tgtXPub;
					}
				}
			}
		}
	}

	/**
	 * Return a plain old js object with wallet properties
	 */
	toPojo() {
		return {
			wallet: {
				final_balance: this.wallet.finalBalance,
			},
			info: {
				fees: this.info.fees,
				estimatorFees: this.info.estimatorFees,
				latest_block: this.info.latestBlock,
			},
			addresses: this.addresses.map((a) => a.toPojo()),
			txs: this.txs,
			unspent_outputs: this.unspentOutputs,
			n_tx: this.nTx,
		};
	}
}

export default WalletInfo;

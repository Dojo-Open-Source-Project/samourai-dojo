/*!
 * lib/wallet/hd-account-info.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import hdaHelper from "../bitcoin/hd-accounts-helper.js";
import hdaService from "../bitcoin/hd-accounts-service.js";
import rpcLatestBlock from "../bitcoind-rpc/latest-block.js";
import db from "../db/mysql-db-wrapper.js";
import errors from "../errors.js";

interface HdUtxo {
	tx_hash: string;
	tx_output_n: number;
	tx_version: number;
	tx_locktime: number;
	value: number;
	script: string;
	addr: string;
	confirmations: number;
	xpub: {
		m: string;
		path: string;
	};
}

/**
 * @class HdAccountInfo
 * @description A class storing information about the actibity of a hd account
 */
class HdAccountInfo {
	declare xpub: string;
	declare address: string;
	declare account: number;
	declare depth: number;
	declare finalBalance: number;
	declare accountIndex: number;
	declare changeIndex: number;
	declare accountDerivedIndex: number;
	declare changeDerivedIndex: number;
	declare nTx: number;
	declare unspentOutputs: HdUtxo[];
	declare derivation: string | null;
	declare created: number | null;
	declare tracked: boolean;
	/**
	 * Constructor
	 */
	constructor(xpub = "") {
		// Initializes properties
		this.xpub = xpub;
		this.address = xpub;
		this.account = 0;
		this.depth = 0;
		this.finalBalance = 0;
		this.accountIndex = 0;
		this.changeIndex = 0;
		this.accountDerivedIndex = 0;
		this.changeDerivedIndex = 0;
		this.nTx = 0;
		this.unspentOutputs = [];
		this.derivation = null;
		this.created = null;
		this.tracked = false;
	}

	/**
	 * @description Ensure the hd account exists in database. Otherwise, tries to import it with BIP44 derivation
	 */
	async ensureHdAccount() {
		try {
			const id = await db.getHDAccountId(this.xpub);
			return id;
		} catch (error) {
			if (error === errors.db.ERROR_NO_HD_ACCOUNT) {
				try {
					// Default to BIP44 import
					return hdaService.restoreHdAccount(this.xpub, hdaHelper.BIP44);
				} catch {
					return null;
				}
			}
			return null;
		}
	}

	/**
	 * @description Load information about the hd account
	 */
	async loadInfo() {
		try {
			await Promise.all([
				this._loadDerivationInfo(),
				this._loadBalance(),
				this._loadUnusedIndices(),
				this._loadDerivedIndices(),
				this._loadNbTransactions(),
			]);
			return true;
		} catch {
			return false;
		}
	}

	async _loadDerivationInfo() {
		const account = await db.getHDAccount(this.xpub);
		this.created = account.hdCreated;
		this.derivation = hdaHelper.typeString(account.hdType);
		this.tracked = true;
		const node = hdaHelper.getNode(this.xpub);
		if (node == null) throw errors.xpub.INVALID;
		const index = node[2].index;
		const threshold = 2 ** 31;
		const hardened = index >= threshold;
		this.account = hardened ? index - threshold : index;
		this.depth = node[2].depth;
	}

	async _loadBalance() {
		this.finalBalance = (await db.getHDAccountBalance(this.xpub)) ?? 0;
	}

	async _loadUnusedIndices() {
		const unusedIndex = await db.getHDAccountNextUnusedIndices(this.xpub);
		this.accountIndex = unusedIndex[0];
		this.changeIndex = unusedIndex[1];
	}

	async _loadDerivedIndices() {
		const derivedIndex = await db.getHDAccountDerivedIndices(this.xpub);
		this.accountDerivedIndex = derivedIndex[0];
		this.changeDerivedIndex = derivedIndex[1];
	}

	async _loadNbTransactions() {
		this.nTx = (await db.getHDAccountNbTransactions(this.xpub)) ?? 0;
	}

	/**
	 * @description Load the utxos associated to the hd account
	 */
	async loadUtxos() {
		this.unspentOutputs = [];

		const utxos = await db.getHDAccountUnspentOutputs(this.xpub);

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
				xpub: {
					m: this.xpub,
					path: ["M", utxo.hdAddrChain, utxo.hdAddrIndex].join("/"),
				},
			};

			this.unspentOutputs.push(entry);
		}

		// Order the utxos
		this.unspentOutputs.sort((a, b) => b.confirmations - a.confirmations);

		return this.unspentOutputs;
	}

	/**
	 * @description Return a plain old js object with hd account properties
	 */
	toPojo() {
		return {
			address: this.address,
			final_balance: this.finalBalance,
			account_index: this.accountIndex,
			change_index: this.changeIndex,
			n_tx: this.nTx,
			derivation: this.derivation,
			created: this.created,
		};
	}

	/**
	 * @description Return a plain old js object with hd account properties (extended version)
	 */
	toPojoExtended() {
		return {
			xpub: this.xpub,
			tracked: this.tracked,
			balance: this.finalBalance,
			unused: {
				external: this.accountIndex,
				internal: this.changeIndex,
			},
			derived: {
				external: this.accountDerivedIndex,
				internal: this.changeDerivedIndex,
			},
			n_tx: this.nTx,
			derivation: this.derivation,
			account: this.account,
			depth: this.depth,
			created: new Date((this.created ?? 0) * 1000).toUTCString(),
		};
	}
}

export default HdAccountInfo;

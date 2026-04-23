/*!
 * lib/wallet/hd-account-info.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import hdaHelper from "../bitcoin/hd-accounts-helper.js";
import hdaService from "../bitcoin/hd-accounts-service.js";
import rpcLatestBlock from "../bitcoind-rpc/latest-block.js";
import db from "../db/mysql-db-wrapper.js";
import errors from "../errors.js";

/**
 * @class HdAccountInfo
 * @description A class storing information about the actibity of a hd account
 */
class HdAccountInfo {
	/**
	 * Constructor
	 * @param {string} xpub - xpub
	 */
	constructor(xpub) {
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
	 * @returns {Promise<number | null>} return the internal id of the hd account
	 *    or null if it doesn't exist
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
	 * @returns {Promise<boolean>}
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
		const index = node[2].index;
		const threshold = 2 ** 31;
		const hardened = index >= threshold;
		this.account = hardened ? index - threshold : index;
		this.depth = node[2].depth;
	}

	/**
	 * @returns {Promise<void>}
	 */
	async _loadBalance() {
		this.finalBalance = await db.getHDAccountBalance(this.xpub);
	}

	/**
	 * @returns {Promise<void>}
	 */
	async _loadUnusedIndices() {
		const unusedIndex = await db.getHDAccountNextUnusedIndices(this.xpub);
		this.accountIndex = unusedIndex[0];
		this.changeIndex = unusedIndex[1];
	}

	/**
	 * @returns {Promise<void>}
	 */
	async _loadDerivedIndices() {
		const derivedIndex = await db.getHDAccountDerivedIndices(this.xpub);
		this.accountDerivedIndex = derivedIndex[0];
		this.changeDerivedIndex = derivedIndex[1];
	}

	/**
	 * @returns {Promise<void>}
	 */
	async _loadNbTransactions() {
		this.nTx = await db.getHDAccountNbTransactions(this.xpub);
	}

	/**
	 * @description Load the utxos associated to the hd account
	 * @returns {Promise<object[]>}
	 */
	async loadUtxos() {
		this.unspentOutputs = [];

		const utxos = await db.getHDAccountUnspentOutputs(this.xpub);

		for (const utxo of utxos) {
			const config =
				utxo.blockHeight == null
					? 0
					: rpcLatestBlock.height - utxo.blockHeight + 1;

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
	 * @returns {object}
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
	 * @returns {object}
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
			created: new Date(this.created * 1000).toGMTString(),
		};
	}
}

export default HdAccountInfo;

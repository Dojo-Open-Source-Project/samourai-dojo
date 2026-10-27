/*!
 * lib/wallet/address-info.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import hdaHelper from "../bitcoin/hd-accounts-helper.js";
import type { ApiTransaction } from "../db/mysql-db-wrapper.js";
import db from "../db/mysql-db-wrapper.js";

interface AddressUtxo {
	txid: string;
	vout: number;
	amount: number;
	confirmations?: number;
}

/**
 * @class AddressInfo
 * @description A class storing information about the actibity of an address
 */
class AddressInfo {
	declare address: string;
	declare pubkey: string | null;
	declare finalBalance: number;
	declare nTx: number;
	declare unspentOutputs: AddressUtxo[];
	declare tracked: boolean;
	declare type: "untracked" | "hd" | "loose";
	declare xpub: string | null;
	declare path: string | null;
	declare segwit: boolean | null;
	declare txs: ApiTransaction[];
	/**
	 * Constructor
	 * @constructor
	 */
	constructor(address = "") {
		// Initializes properties
		this.address = address;
		this.pubkey = null;
		this.finalBalance = 0;
		this.nTx = 0;
		this.unspentOutputs = [];

		this.tracked = false;
		this.type = "untracked";
		this.xpub = null;
		this.path = null;
		this.segwit = null;
		this.txs = [];
	}

	/**
	 * @description Load information about the address
	 */
	async loadInfo() {
		return Promise.all([this._loadBalance(), this._loadNbTransactions()]);
	}

	async _loadBalance() {
		const balance = await db.getAddressBalance(this.address);
		if (balance !== null) this.finalBalance = balance;
	}

	async _loadNbTransactions() {
		const nbTxs = await db.getAddressNbTransactions(this.address);
		if (nbTxs !== null) this.nTx = nbTxs;
	}

	/**
	 * @description Load information about the address (extended form)
	 */
	async loadInfoExtended() {
		const res = await db.getHDAccountsByAddresses([this.address]);

		for (const xpub in res.hd) {
			const xpubType = hdaHelper.classify(res.hd[xpub].hdType).type;
			const info = res.hd[xpub].addresses[0];
			this.tracked = true;
			this.type = "hd";
			this.xpub = xpub;
			this.segwit =
				xpubType === hdaHelper.BIP49 || xpubType === hdaHelper.BIP84;
			this.path = ["M", info.hdAddrChain, info.hdAddrIndex].join("/");
		}

		for (const a of res.loose) {
			if (a.addrAddress === this.address) {
				this.tracked = true;
				this.type = "loose";
				break;
			}
		}

		return this.loadInfo();
	}

	/**
	 * @description Loads a partial list of transactions for this address
	 */
	async loadTransactions() {
		this.txs = (await db.getTxsByAddrAndXpubs([
			this.address,
		])) as ApiTransaction[];
	}

	/**
	 * @description Load the utxos associated to the address
	 */
	async loadUtxos() {
		this.unspentOutputs = [];

		const res = await db.getUnspentOutputs([this.address]);

		for (const r of res) {
			this.unspentOutputs.push({
				txid: r.txnTxid,
				vout: r.outIndex,
				amount: r.outAmount,
			});
		}

		// Order the utxos
		this.unspentOutputs.sort(
			(a, b) => (b.confirmations ?? 0) - (a.confirmations ?? 0),
		);
		return this.unspentOutputs;
	}

	/**
	 * @description Return a plain old js object with address properties
	 */
	toPojo() {
		const returnValue: {
			address: string;
			final_balance: number;
			n_tx: number;
			pubkey?: string;
		} = {
			address: this.address,
			final_balance: this.finalBalance,
			n_tx: this.nTx,
		};

		if (this.pubkey) returnValue.pubkey = this.pubkey;

		return returnValue;
	}

	/**
	 * @description Return a plain old js object with address properties (extended version)
	 */
	toPojoExtended() {
		const returnValue: {
			address: string;
			tracked: boolean;
			type: "untracked" | "hd" | "loose";
			balance: number;
			xpub: string | null;
			path: string | null;
			segwit: boolean | null;
			n_tx: number;
			txids: Array<string | undefined>;
			utxo: AddressUtxo[];
			pubkey?: string;
		} = {
			address: this.address,
			tracked: this.tracked,
			type: this.type,
			balance: this.finalBalance,
			xpub: this.xpub,
			path: this.path,
			segwit: this.segwit,
			n_tx: this.nTx,
			txids: this.txs.map((t) => t.hash),
			utxo: this.unspentOutputs,
		};

		if (this.pubkey) returnValue.pubkey = this.pubkey;

		return returnValue;
	}
}

export default AddressInfo;

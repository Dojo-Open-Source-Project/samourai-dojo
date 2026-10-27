/*!
 * lib/wallet/wallet-entities.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

/**
 * @class WalletEntities
 * @description A class storing entities (xpubs, addresses, pubkeys) defining a (full|partial) wallet
 */
class WalletEntities {
	declare pubkeys: Array<string | false | undefined>;
	declare addrs: string[];
	declare xpubs: string[];
	declare ypubs: Array<string | false | undefined>;
	declare zpubs: Array<string | false | undefined>;
	/**
	 * @constructor
	 */
	constructor() {
		this.pubkeys = [];
		this.addrs = [];
		this.xpubs = [];
		this.ypubs = [];
		this.zpubs = [];
	}

	/**
	 * @description Add a new hd account with its translation as an xpub
	 */
	addHdAccount(xpub: string, ypub?: string | false, zpub?: string | false) {
		this.xpubs.push(xpub);
		this.ypubs.push(ypub);
		this.zpubs.push(zpub);
	}

	/**
	 * @description Add a new address/pubkey
	 */
	addAddress(address: string, pubkey?: string | false) {
		this.addrs.push(address);
		this.pubkeys.push(pubkey);
	}

	/**
	 * @description Update the pubkey associated to a given address
	 */
	updatePubKey(address: string, pubkey: string) {
		const indexAddr = this.addrs.indexOf(address);
		if (indexAddr > -1) this.pubkeys[indexAddr] = pubkey;
	}

	/**
	 * @description Checks if a xpub is already listed
	 */
	hasXPub(xpub: string) {
		return this.xpubs.includes(xpub);
	}

	/**
	 * @description Checks if an address is already listed
	 */
	hasAddress(address: string) {
		return this.addrs.includes(address);
	}

	/**
	 * @description Checks if a pubkey is already listed
	 */
	hasPubKey(pubkey: string) {
		return this.pubkeys.includes(pubkey);
	}
}

export default WalletEntities;

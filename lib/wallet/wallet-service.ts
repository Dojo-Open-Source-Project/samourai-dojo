/*!
 * lib/wallet/wallet-service.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../../keys/index.js";
import hdaHelper from "../bitcoin/hd-accounts-helper.js";
import hdaService from "../bitcoin/hd-accounts-service.js";
import network from "../bitcoin/network.js";
import type { ApiTransaction } from "../db/mysql-db-wrapper.js";
import db from "../db/mysql-db-wrapper.js";
import Logger from "../logger.js";
import util from "../util.js";
import WalletEntities from "./wallet-entities.js";
import WalletInfo from "./wallet-info.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * A singleton providing a wallets service
 */
class WalletService {
	/**
	 * Get full wallet information
	 */
	async getFullWalletInfo(
		active: WalletEntities,
		legacy: WalletEntities,
		bip49: WalletEntities,
		bip84: WalletEntities,
		pubkeys: WalletEntities,
	) {
		// Check parameters
		const validParameters = this._checkEntities(
			active,
			legacy,
			bip49,
			bip84,
			pubkeys,
		);

		if (!validParameters) {
			const info = new WalletInfo(new WalletEntities());
			const returnValue = this._formatGetFullWalletInfoResult(info);
			return returnValue;
		}

		// Merge all entities into active mapping
		active = this._mergeEntities(active, legacy, bip49, bip84, pubkeys);

		// Initialize a WalletInfo object
		const walletInfo = new WalletInfo(active);

		try {
			await Promise.all([
				// Add the new xpubs
				util.parallelCall(legacy.xpubs, this._newBIP44),
				util.parallelCall(bip49.xpubs, this._newBIP49),
				util.parallelCall(bip84.xpubs, this._newBIP84),
				// Add the new addresses
				db.addAddresses(legacy.addrs),
				db.addAddresses(bip49.addrs),
				db.addAddresses(bip84.addrs),
				db.addAddresses(pubkeys.addrs),
			]);

			// Ensure hd accounts and addresses exist
			await Promise.all([
				walletInfo.ensureHdAccounts(),
				walletInfo.ensureAddresses(),
			]);

			// Force import of addresses associated to paynyms
			// if dojo relies on a local index
			if (keys.indexer.active !== "third_party_explorer")
				await this._forceEnsureAddressesForActivePubkeys(active);

			// Filter the addresses
			await walletInfo.filterAddresses();

			// Load wallet information
			await Promise.all([
				// Load the hd accounts,
				walletInfo.loadHdAccountsInfo(),
				// Load the utxos
				walletInfo.loadUtxos(),
				// Load the addresses
				walletInfo.loadAddressesInfo(),
				// Load the most recent transactions
				walletInfo.loadTransactions(0, null, true),
				// Load feerates
				walletInfo.loadFeesInfo(),
			]);

			// Postprocessing
			await Promise.all([
				walletInfo.postProcessAddresses(),
				walletInfo.postProcessHdAccounts(),
			]);

			// Format the result
			return this._formatGetFullWalletInfoResult(walletInfo);
		} catch (error) {
			Logger.error(error, "WalletService.getWalletInfo()");
			throw "Internal server error";
		}
	}

	/**
	 * Get wallet information
	 * @deprecated
	 */
	async getWalletInfo(
		active: WalletEntities,
		legacy: WalletEntities,
		bip49: WalletEntities,
		bip84: WalletEntities,
		pubkeys: WalletEntities,
	) {
		// Check parameters
		const validParameters = this._checkEntities(
			active,
			legacy,
			bip49,
			bip84,
			pubkeys,
		);

		if (!validParameters) {
			const info = new WalletInfo(new WalletEntities());
			const returnValue = this._formatGetWalletInfoResult(info);
			return returnValue;
		}

		// Merge all entities into active mapping
		active = this._mergeEntities(active, legacy, bip49, bip84, pubkeys);

		// Initialize a WalletInfo object
		const walletInfo = new WalletInfo(active);

		try {
			// Add the new xpubs
			await util.seriesCall(legacy.xpubs, this._newBIP44);
			await util.seriesCall(bip49.xpubs, this._newBIP49);
			await util.seriesCall(bip84.xpubs, this._newBIP84);
			// Load hd accounts info
			await walletInfo.ensureHdAccounts();
			await walletInfo.loadHdAccountsInfo();
			// Add the new addresses
			await db.addAddresses(legacy.addrs);
			await db.addAddresses(bip49.addrs);
			await db.addAddresses(bip84.addrs);
			await db.addAddresses(pubkeys.addrs);
			// Ensure addresses exist
			await walletInfo.ensureAddresses();
			// Force import of addresses associated to paynyms
			// if dojo relies on a local index
			if (keys.indexer.active !== "third_party_explorer")
				await this._forceEnsureAddressesForActivePubkeys(active);
			// Filter the address and load them
			await walletInfo.filterAddresses();
			await walletInfo.loadAddressesInfo();
			// Load the most recent transactions
			await walletInfo.loadTransactions(0, null, true);
			// Postprocessing
			await walletInfo.postProcessAddresses();
			await walletInfo.postProcessHdAccounts();
			// Format the result
			return this._formatGetWalletInfoResult(walletInfo);
		} catch (error) {
			Logger.error(error, "WalletService.getWalletInfo()");
			throw "Internal server error";
		}
	}

	/**
	 * Prepares the result to be returned by getFullWalletInfo()
	 */
	_formatGetFullWalletInfoResult(info: WalletInfo) {
		const returnValue = info.toPojo();

		delete returnValue.n_tx;

		returnValue.addresses = returnValue.addresses.map((x) => {
			const address = {
				...x,
				derivation: "derivation" in x ? x.derivation : undefined,
				created: "created" in x ? x.created : undefined,
			};
			delete address.derivation;
			delete address.created;
			return address;
		});

		return returnValue;
	}

	/**
	 * Prepares the result to be returned by getWalletInfo()
	 * @deprecated
	 */
	_formatGetWalletInfoResult(info: WalletInfo) {
		const returnValue = info.toPojo();

		delete returnValue.n_tx;
		delete returnValue.unspent_outputs;
		delete returnValue.info.fees;

		returnValue.addresses = returnValue.addresses.map((x) => {
			const address = {
				...x,
				derivation: "derivation" in x ? x.derivation : undefined,
				created: "created" in x ? x.created : undefined,
			};
			delete address.derivation;
			delete address.created;
			return address;
		});

		return returnValue;
	}

	/**
	 * Get wallet unspent outputs
	 * @deprecated
	 */
	async getWalletUtxos(
		active: WalletEntities,
		legacy: WalletEntities,
		bip49: WalletEntities,
		bip84: WalletEntities,
		pubkeys: WalletEntities,
	) {
		const returnValue = {
			unspent_outputs: [] as unknown[],
		};

		// Check parameters
		const validParameters = this._checkEntities(
			active,
			legacy,
			bip49,
			bip84,
			pubkeys,
		);
		if (!validParameters) return returnValue;

		// Merge all entities into active mapping
		active = this._mergeEntities(active, legacy, bip49, bip84, pubkeys);

		// Initialize a WalletInfo object
		const walletInfo = new WalletInfo(active);

		try {
			// Add the new xpubs
			await util.seriesCall(legacy.xpubs, this._newBIP44);
			await util.seriesCall(bip49.xpubs, this._newBIP49);
			await util.seriesCall(bip84.xpubs, this._newBIP84);
			// Ensure hd accounts exist
			await walletInfo.ensureHdAccounts();
			// Add the new addresses
			await db.addAddresses(legacy.addrs);
			await db.addAddresses(bip49.addrs);
			await db.addAddresses(bip84.addrs);
			await db.addAddresses(pubkeys.addrs);
			// Ensure addresses exist
			await walletInfo.ensureAddresses();
			// Force import of addresses associated to paynyms
			// if dojo relies on a local index
			if (keys.indexer.active !== "third_party_explorer")
				await this._forceEnsureAddressesForActivePubkeys(active);
			// Filter the addresses
			await walletInfo.filterAddresses();
			// Load the utxos
			await walletInfo.loadUtxos();
			// Postprocessing
			await walletInfo.postProcessAddresses();
			await walletInfo.postProcessHdAccounts();
			// Format the result
			returnValue.unspent_outputs = walletInfo.unspentOutputs;
			return returnValue;
		} catch (error) {
			Logger.error(error, "WalletService.getWalletUtxos()");
			throw "Internal server error";
		}
	}

	/**
	 * Get a subset of wallet transactions
	 */
	async getWalletTransactions(
		entities: WalletEntities,
		page?: number,
		count?: number,
	) {
		const returnValue = {
			n_tx: 0,
			page: page,
			n_tx_page: count,
			txs: [] as ApiTransaction[],
		};

		// Check parameters
		if (entities.xpubs.length === 0 && entities.addrs.length === 0)
			return returnValue;

		// Initialize a WalletInfo object
		const walletInfo = new WalletInfo(entities);

		try {
			// Filter the addresses
			await walletInfo.filterAddresses();

			await Promise.all([
				// Load the number of transactions
				walletInfo.loadNbTransactions(),
				// Load the requested page of transactions
				walletInfo.loadTransactions(page, count, false),
			]);

			// Postprocessing
			await walletInfo.postProcessAddresses();
			await walletInfo.postProcessHdAccounts();

			// Format the result
			returnValue.n_tx = walletInfo.nTx;
			returnValue.txs = walletInfo.txs;
			return returnValue;
		} catch (error) {
			Logger.error(error, "WalletService.getWalletTransactions()");
			throw "Internal server error";
		}
	}

	/**
	 * Force addresses derived from an active pubkey to be stored in database
	 */
	async _forceEnsureAddressesForActivePubkeys(active: WalletEntities) {
		const filteredAddrs: string[] = [];
		for (const index in active.addrs) {
			if (active.pubkeys[index]) {
				filteredAddrs.push(active.addrs[index]);
			}
		}
		return db.addAddresses(filteredAddrs);
	}

	/**
	 * Check entities
	 */
	_checkEntities(
		active: WalletEntities,
		legacy: WalletEntities,
		bip49: WalletEntities,
		bip84: WalletEntities,
		pubkeys: WalletEntities,
	) {
		const allEmpty =
			active.xpubs.length === 0 &&
			active.addrs.length === 0 &&
			legacy.xpubs.length === 0 &&
			legacy.addrs.length === 0 &&
			pubkeys.addrs.length === 0 &&
			bip49.xpubs.length === 0 &&
			bip84.xpubs.length === 0;

		return !allEmpty;
	}

	/**
	 * Merge all entities into active mapping
	 */
	_mergeEntities(
		active: WalletEntities,
		legacy: WalletEntities,
		bip49: WalletEntities,
		bip84: WalletEntities,
		pubkeys: WalletEntities,
	) {
		// Put all xpub into active.xpubs
		active.xpubs = [
			...active.xpubs,
			...legacy.xpubs,
			...bip49.xpubs,
			...bip84.xpubs,
		];

		// Put addresses and pubkeys into active
		// but avoid duplicates
		for (const source of [legacy, pubkeys]) {
			for (const indexSource in source.addrs) {
				const addr = source.addrs[indexSource];
				const pubkey = source.pubkeys[indexSource];
				const indexActive = active.addrs.indexOf(addr);

				if (indexActive === -1) {
					active.addrs.push(addr);
					active.pubkeys.push(pubkey);
				} else if (pubkey) {
					active.pubkeys[indexActive] = pubkey;
				}
			}
		}

		return active;
	}

	/**
	 * Create a new BIP44 hd account into the database
	 */
	async _newBIP44(xpub: string) {
		return hdaService.createHdAccount(xpub, hdaHelper.BIP44);
	}

	/**
	 * Create a new BIP49 hd account into the database
	 */
	async _newBIP49(xpub: string) {
		return hdaService.createHdAccount(xpub, hdaHelper.BIP49);
	}

	/**
	 * Create a new BIP84 hd account into the database
	 */
	async _newBIP84(xpub: string) {
		return hdaService.createHdAccount(xpub, hdaHelper.BIP84);
	}
}

export default new WalletService();

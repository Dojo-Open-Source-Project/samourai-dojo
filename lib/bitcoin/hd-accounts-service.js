/*!
 * lib/bitcoin/hd-accounts-service.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../../keys/index.js";
import db from "../db/mysql-db-wrapper.js";
import errors from "../errors.js";
import Logger from "../logger.js";
import remote from "../remote-importer/remote-importer.js";
import util from "../util.js";
import addrHelper from "./addresses-helper.js";
import hdaHelper from "./hd-accounts-helper.js";
import network from "./network.js";

const gap = keysFile[network.key].gap;

/**
 * A singleton providing a HD Accounts service
 */
class HDAccountsService {
	/**
	 * Create a new hd account in db
	 * @param {string} xpub - xpub
	 * @param {number} scheme - derivation scheme
	 * @returns {Promise} returns true if success, false otherwise
	 */
	async createHdAccount(xpub, scheme) {
		try {
			await this.newHdAccount(xpub, scheme);
			return true;
		} catch (error) {
			const isInvalidXpub =
				error === errors.xpub.INVALID || error === errors.xpub.PRIVKEY;
			const isLockedXpub = error === errors.xpub.LOCKED;
			const error_ = isInvalidXpub || isLockedXpub ? error : errors.xpub.CREATE;
			Logger.error(error, `HdAccountsService : createHdAccount()${error_}`);
			throw error_;
		}
	}

	/**
	 * Restore a hd account in db
	 * @param {string} xpub - xpub
	 * @param {number} scheme - derivation scheme
	 * @param {boolean} forceOverride - force override of scheme even if hd account is locked
	 * @returns {Promise}
	 */
	async restoreHdAccount(xpub, scheme, forceOverride) {
		let isLocked;

		// Check if hd accounts exists in db and is locked
		try {
			const account = await db.getHDAccount(xpub);
			const info = hdaHelper.classify(account.hdType);
			isLocked = info.locked;
		} catch (error) {
			Logger.error(error, "HdAccountsService : restoreHdAccount()");
		}

		// Override derivation scheme if needed
		await this.derivationOverrideCheck(xpub, scheme, forceOverride);

		//import the hd account
		await remote.importHDAccount(xpub, scheme);

		// Lock the hd account if needed
		if (isLocked) return this.lockHdAccount(xpub, true);
	}

	/**
	 * Lock a hd account
	 * @param {string} xpub - xpub
	 * @param {boolean} lock - true for locking, false for unlocking
	 * @returns {Promise} returns the derivation type as a string
	 */
	async lockHdAccount(xpub, lock) {
		try {
			const account = await db.getHDAccount(xpub);

			const hdType = account.hdType;
			const info = hdaHelper.classify(hdType);

			if (info.locked === lock) return hdaHelper.typeString(hdType);

			await db.setLockHDAccountType(xpub, lock);

			const type = hdaHelper.makeType(hdType, lock);
			return hdaHelper.typeString(type);
		} catch (error) {
			const error_ =
				error === errors.db.ERROR_NO_HD_ACCOUNT
					? errors.get.UNKNXPUB
					: errors.generic.DB;
			throw error_;
		}
	}

	/**
	 * Delete a hd account
	 * @param {string} xpub - xpub
	 * @returns {Promise}
	 */
	async deleteHdAccount(xpub) {
		try {
			await db.deleteHDAccount(xpub);
		} catch (error) {
			const error_ =
				error === errors.db.ERROR_NO_HD_ACCOUNT
					? errors.get.UNKNXPUB
					: errors.generic.DB;
			throw error_;
		}
	}

	/**
	 * Create a new xpub in db
	 * @param {string} xpub - xpub
	 * @param {number} scheme - derivation scheme
	 * @returns {Promise}
	 */
	async newHdAccount(xpub, scheme) {
		// Get the HDNode bitcoinjs object.
		// Throws if xpub is actually a private key
		const HDNode = hdaHelper.getNode(xpub);

		if (HDNode === null) throw errors.xpub.INVALID;

		await this.derivationOverrideCheck(xpub, scheme);
		await db.ensureHDAccountId(xpub, scheme);

		let segwit = "";

		if (scheme === hdaHelper.BIP49) segwit = " SegWit (BIP49)";
		else if (scheme === hdaHelper.BIP84) segwit = " SegWit (BIP84)";

		Logger.info(`HdAccountsService : Created HD Account: ${xpub}${segwit}`);

		const externalPrm = hdaHelper.deriveAddresses(
			xpub,
			0,
			util.range(0, gap.external),
			scheme,
		);
		const internalPrm = hdaHelper.deriveAddresses(
			xpub,
			1,
			util.range(0, gap.internal),
			scheme,
		);

		const addressArr = await Promise.all([externalPrm, internalPrm]);

		const addresses = addressArr.flat();

		return db.addAddressesToHDAccount(xpub, addresses);
	}

	/**
	 * Rescan the blockchain for a hd account
	 * @param {string} xpub - xpub
	 * @param {number=} gapLimit - (optional) gap limit for derivation
	 * @param {number=} startIndex - (optional) rescan shall start from this index
	 * @returns {Promise}
	 */
	async rescan(xpub, gapLimit, startIndex) {
		// Force rescan
		remote.clearGuard(xpub);

		const account = await db.getHDAccount(xpub);
		await remote.importHDAccount(xpub, account.hdType, gapLimit, startIndex);
	}

	/**
	 * Check if a xpub is currently beingimported or rescanned by Dojo
	 * Returns true ifimport/rescan is in progress, otherwise returns false
	 * @param {string} xpub - xpub
	 * @returns {Promise}
	 */
	importInProgress(xpub) {
		return remote.importInProgress(xpub);
	}

	/**
	 * Check if we try to override an existing xpub
	 * Delete the old xpub from db if it's the case
	 * @param {string} xpub - xpub
	 * @param {number} scheme - derivation scheme
	 * @param {boolean=} forceOverride - force override of scheme even if hd account is locked
	 *  (default = false)
	 * @returns {Promise}
	 */
	async derivationOverrideCheck(xpub, scheme, forceOverride) {
		let account;

		// Nothing to do here if hd account doesn't exist in db
		try {
			account = await db.getHDAccount(xpub);
		} catch {
			return;
		}

		try {
			const info = hdaHelper.classify(account.hdType);
			// If this account is already known in the database,
			// check for a derivation scheme mismatch
			if (info.type !== scheme) {
				if (info.locked && !forceOverride) {
					Logger.info(
						`HdAccountsService : Attempted override on locked account: ${xpub}`,
					);
					throw errors.xpub.LOCKED;
				} else {
					Logger.info(
						`HdAccountsService : Derivation scheme override: ${xpub}`,
					);
					return db.deleteHDAccount(xpub);
				}
			}
		} catch (error) {
			Logger.error(error, "HDAccountsService : derivationOverrideCheck()");
			throw error;
		}
	}

	/**
	 * Verify that a given message has been signed
	 * with the first external key of a known xpub/ypub/zpub
	 *
	 * @param {string} xpub - xpub
	 * @param {string} address - address used to sign the message
	 * @param {string} sig - signature of the message
	 * @param {string} msg - signed message
	 * @param {number} scheme - derivation scheme to be used for the xpub
	 * @returns {Promise} returns the xpub if signature is valid, otherwise returns an error
	 */
	async verifyXpubSignature(xpub, address, sig, msg, scheme) {
		// Derive addresses (P2PKH addresse used for signature + expected address)
		const sigAddressRecord = await hdaHelper.deriveAddresses(
			xpub,
			1,
			[0],
			hdaHelper.BIP44,
		);
		const sigAddress = sigAddressRecord[0].address;

		const expectedAddressRecord = await hdaHelper.deriveAddresses(
			xpub,
			1,
			[0],
			scheme,
		);
		const expectedAddress = expectedAddressRecord[0].address;

		try {
			// Check that xpub exists in db
			await db.getHDAccountId(xpub);
			// Check the signature
			if (!addrHelper.verifySignature(msg, sigAddress, sig))
				throw errors.sig.INVSIG;
			// Check that adresses match
			if (address !== expectedAddress) throw errors.sig.INVADDR;
			// Return the corresponding xpub
			return xpub;
		} catch (error) {
			const returnValue =
				error === errors.db.ERROR_NO_HD_ACCOUNT
					? errors.get.UNKNXPUB
					: errors.generic.DB;
			throw returnValue;
		}
	}

	/**
	 * @description
	 * @param {string[]} xpubs - array of xpubs
	 * @returns {Promise<void>}
	 */
	async importPostmixLikeTypeChange(xpubs) {
		const postmixAcct = xpubs.find((xpub) => {
			const node = hdaHelper.getNode(xpub);

			return hdaHelper.isPostmixAcct(node);
		});

		if (!postmixAcct) return;

		const postmixNode = hdaHelper.getNode(postmixAcct);
		const [, internalUnused] =
			await db.getHDAccountNextUnusedIndices(postmixAcct);

		const deriveRange = util.range(
			Math.max(0, internalUnused - 50),
			internalUnused + gap.internal,
		);

		const likeTypeChangeAddresses = await Promise.all(
			deriveRange.flatMap((index) => {
				return [
					hdaHelper.deriveAddress(1, postmixNode[1], index, hdaHelper.BIP44),
					hdaHelper.deriveAddress(1, postmixNode[1], index, hdaHelper.BIP49),
				];
			}),
		);

		await db.addAddressesToHDAccount(postmixAcct, likeTypeChangeAddresses);
	}
}

export default new HDAccountsService();

/*!
 * lib/bitcoin/addresses-service.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import db from "../db/mysql-db-wrapper.js";
import remote from "../remote-importer/remote-importer.js";

/**
 * A singleton providing an Adresses service
 */
class AddressesService {
	/**
	 * Rescan the blockchain for an address
	 * @param {string} address - bitcoin address
	 * @returns {Promise<boolean | undefined>}
	 */
	async rescan(address) {
		const hdaccount = await db.getUngroupedHDAccountsByAddresses([address]);
		// Don't filter addresses associated to an HDAccount
		const filterAddr = !(hdaccount.length > 0 && hdaccount[0].hdID);
		return await remote.importAddresses([address], filterAddr);
	}

	/**
	 * Restore an address in db
	 * @param {string[]} addresses - array of bitcoin addresses
	 * @param {boolean} filterAddr - true if addresses should be filter, false otherwise
	 * @returns {Promise<boolean | undefined>}
	 */
	async restoreAddresses(addresses, filterAddr) {
		return await remote.importAddresses(addresses, filterAddr);
	}
}

export default new AddressesService();

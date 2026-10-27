/*!
 * scripts/patches/translate-hd-accounts.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import hdaHelper from "../../lib/bitcoin/hd-accounts-helper.js";
import type {
	DbWriteResult,
	HdAccountRow,
} from "../../lib/db/mysql-db-types.js";
import db from "../../lib/db/mysql-db-wrapper.js";

/**
 * Retrieve hd accounts from db
 */
async function getHdAccounts() {
	const query = "SELECT `hdID`, `hdXpub`, `hdType`  FROM `hd`";
	return db._query<Pick<HdAccountRow, "hdID" | "hdXpub" | "hdType">[]>(query);
}

/**
 * Update the xpub of a hdaccount
 */
async function updateHdAccount(hdId?: number, xpub?: string) {
	const query = "UPDATE `hd` SET `hdXpub` = ? WHERE `hdID` = ?";
	const parameters = [xpub, hdId];
	return db._query<DbWriteResult>(query, parameters);
}

/**
 * Script translating when needed
 * xpubs stored in db into ypub and zpub
 */
async function run() {
	try {
		const hdAccounts = await getHdAccounts();

		for (const account of hdAccounts) {
			const hdId = account.hdID;
			const xpub = account.hdXpub;
			const info = hdaHelper.classify(account.hdType);
			const scheme = info.type;

			if (scheme === hdaHelper.BIP49 || scheme === hdaHelper.BIP84) {
				try {
					const xlatedXpub = hdaHelper.xlatXPUB(xpub);
					await updateHdAccount(hdId, xlatedXpub);
					console.log(`Updated ${hdId} (${xpub} => ${xlatedXpub})`);
				} catch (error) {
					console.log("A problem was met");
					console.log(error);
				}
			}
		}
	} catch (error) {
		console.log("A problem was met");
		console.log(error);
	}
}

/**
 * Launch the script
 */
console.log("Start processing");

setTimeout(async () => {
	return run().then(() => {
		console.log("Process completed");
	});
}, 1500);

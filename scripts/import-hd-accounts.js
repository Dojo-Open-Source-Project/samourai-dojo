/*!
 * scripts/import-hd-accounts.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import apiHelper from "../accounts/api-helper.js";
import hdaHelper from "../lib/bitcoin/hd-accounts-helper.js";
import hdaService from "../lib/bitcoin/hd-accounts-service.js";
import Logger from "../lib/logger.js";

/**
 * Script importing a list of hdaccounts (xpubs, ypubs, zpubs) into the database
 * Used to declare the xpub, ypub, zpub into the database before the initial setup
 */

async function run(strEntities) {
	const entities = apiHelper.parseEntities(strEntities);

	if (entities.xpubs.length > 0) {
		for (let i = 0; i < entities.xpubs.length; i++) {
			const xpub = entities.xpubs[i];

			let scheme = hdaHelper.BIP44;

			if (entities.ypubs[i]) scheme = hdaHelper.BIP49;
			else if (entities.zpubs[i]) scheme = hdaHelper.BIP84;

			await hdaService.createHdAccount(xpub, scheme);
		}
	}
}

/**
 * Launch the script
 */

// Retrieves command line arguments
if (process.argv.length < 3) {
	Logger.error(
		null,
		"Missing arguments. Command = import-hd-accounts.js <xpub1>|<ypub1>|<zpub1>|...",
	);
	process.exit(1);
}

Logger.info("Start processing");

const entities = process.argv[2];

setTimeout(async () => {
	return run(entities).then(() => {
		Logger.info("Process completed");
	});
}, 1500);

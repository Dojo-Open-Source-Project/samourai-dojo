/*!
 * accounts/status.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../keys/index.js";
import network from "../lib/bitcoin/network.js";
import db from "../lib/db/mysql-db-wrapper.js";
import Logger from "../lib/logger.js";
import remote from "../lib/remote-importer/remote-importer.js";
import util from "../lib/util.js";

const keys = keysFile[network.key];

/**
 * Singleton providing information about the accounts endpoints
 */
class Status {
	constructor() {
		this.t0 = Date.now();
		this.clients = 0;
		this.sessions = 0;
		this.maxConn = 0;
	}

	/**
	 * Get current status
	 * @returns {Promise<object>} status object
	 */
	async getCurrent() {
		const uptime = util.timePeriod((Date.now() - this.t0) / 1000, false);
		const memory = `${util.toMb(process.memoryUsage().rss)} MiB`;

		// Get highest block processed by the tracker
		let dbMaxHeight = null;
		try {
			const highest = await db.getHighestBlock();
			dbMaxHeight = highest.blockHeight;
		} catch (error) {
			Logger.error(error, "API : Status.getCurrent() :");
		}

		// Get info about the indexer
		const indexerType = keys.indexer.active;
		let indexerMaxHeight = null;
		let indexerUrl = null;

		if (indexerType === "third_party_explorer") {
			indexerUrl =
				network.key === "bitcoin" ? keys.indexer.oxt : keys.indexer.esplora;
		}

		try {
			// Timeout 5000ms for retrieving of chaintip
			const chaintip = await Promise.race([
				remote.getChainTipHeight(),
				util.delay(5000).then(() => ({ chainTipHeight: null })),
			]);
			indexerMaxHeight = chaintip.chainTipHeight;
		} catch (error) {
			Logger.error(error, "API : Status.getCurrent() :");
		}

		return {
			uptime: uptime,
			memory: memory,
			ws: {
				clients: this.clients,
				sessions: this.sessions,
				max: this.maxConn,
			},
			blocks: dbMaxHeight,
			indexer: {
				type: indexerType,
				url: indexerUrl,
				maxHeight: indexerMaxHeight,
			},
		};
	}
}

export default new Status();

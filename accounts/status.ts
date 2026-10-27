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

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * Singleton providing information about the accounts endpoints
 */
class Status {
	declare t0: number;
	declare clients: number;
	declare sessions: number;
	declare maxConn: number;
	constructor() {
		this.t0 = Date.now();
		this.clients = 0;
		this.sessions = 0;
		this.maxConn = 0;
	}

	/**
	 * Get current status
	 */
	async getCurrent() {
		const uptime = util.timePeriod((Date.now() - this.t0) / 1000, false);
		const memory = `${util.toMb(process.memoryUsage().rss)} MiB`;

		// Get highest block processed by the tracker
		let dbMaxHeight: number | null = null;
		try {
			const highest = (await db.getHighestBlock()) as { blockHeight: number };
			dbMaxHeight = highest.blockHeight;
		} catch (error) {
			Logger.error(error, "API : Status.getCurrent() :");
		}

		// Get info about the indexer
		const indexer = keys.indexer as {
			active: string;
			oxt?: string;
			esplora?: string;
		};
		const indexerType = indexer.active;
		let indexerMaxHeight: number | null = null;
		let indexerUrl: string | null = null;

		if (indexerType === "third_party_explorer") {
			indexerUrl =
				network.key === "bitcoin"
					? (indexer.oxt ?? null)
					: (indexer.esplora ?? null);
		}

		try {
			// Timeout 5000ms for retrieving of chaintip
			const chaintip = await Promise.race<{ chainTipHeight: number | null }>([
				remote.getChainTipHeight(),
				util.delay(5000).then(() => ({
					chainTipHeight: null as number | null,
				})),
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

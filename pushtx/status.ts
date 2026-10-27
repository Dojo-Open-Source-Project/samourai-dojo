/*!
 * pushtx/status.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import {
	createRpcClient,
	type DojoRpcClient,
} from "../lib/bitcoind-rpc/rpc-client.js";
import db, { type DbRows } from "../lib/db/mysql-db-wrapper.js";
import Logger from "../lib/logger.js";
import util from "../lib/util.js";

interface PushTxStatus {
	uptime: number;
	memory: number;
	bitcoind: {
		up: boolean;
		conn: number;
		blocks: number;
		version: number;
		protocolversion: number;
		relayfee: number;
		testnet: boolean;
	};
	push: {
		count: number;
		amount: number;
	};
}

interface PushTxStats {
	amount: number;
	count: number;
}

/**
 * Default values for status object
 */
const DEFAULT_STATUS = {
	uptime: 0,
	memory: 0,
	bitcoind: {
		up: false,
		conn: -1,
		blocks: -1,
		version: -1,
		protocolversion: -1,
		relayfee: 0,
		testnet: false,
	},
	push: {
		count: 0,
		amount: 0,
	},
};

const createDefaultStatus = (): PushTxStatus => ({
	uptime: DEFAULT_STATUS.uptime,
	memory: DEFAULT_STATUS.memory,
	bitcoind: { ...DEFAULT_STATUS.bitcoind },
	push: { ...DEFAULT_STATUS.push },
});

/**
 * Singleton providing information about the pushtx service
 */
class Status {
	declare startTime: number;
	declare status: PushTxStatus;
	declare stats: PushTxStats;
	declare rpcClient: DojoRpcClient;
	constructor() {
		this.startTime = Date.now();
		this.status = createDefaultStatus();
		this.stats = {
			amount: 0,
			count: 0,
		};
		this.rpcClient = createRpcClient();
	}

	/**
	 * Update the stats
	 */
	updateStats(amount = 0): void {
		this.stats.count++;
		this.stats.amount += amount;
	}

	/**
	 * Get current status
	 */
	async getCurrent(): Promise<PushTxStatus> {
		const mem = process.memoryUsage();
		this.status.memory = util.toMb(mem.rss);

		this.status.uptime = Number(
			((Date.now() - this.startTime) / 1000).toFixed(1),
		);

		this.status.push.amount = Number((this.stats.amount / 1e8).toFixed(3));
		this.status.push.count = this.stats.count;

		try {
			await Promise.all([
				this._refreshNetworkInfo(),
				this._refreshBlockchainInfo(),
			]);
		} catch (error) {
			Logger.error(error, "PushTx : Status.getCurrent() : Error");
		}

		return this.status;
	}

	/**
	 * Get scheduled transactions
	 */
	async getScheduledTransactions(): Promise<{ nbTxs: number; txs: DbRows }> {
		const returnValue = {
			nbTxs: 0,
			txs: [] as DbRows,
		};

		try {
			returnValue.txs = await db.getScheduledTransactions();
			returnValue.nbTxs = returnValue.txs.length;
		} catch {
			//
		}

		return returnValue;
	}

	/**
	 * Refresh network info
	 */
	async _refreshNetworkInfo(): Promise<void> {
		const info = await this.rpcClient.getnetworkinfo();
		this.status.bitcoind.conn = info.connections ?? -1;
		this.status.bitcoind.version = info.version ?? -1;
		this.status.bitcoind.protocolversion = info.protocolversion ?? -1;
		this.status.bitcoind.relayfee = info.relayfee ?? 0;
	}

	/**
	 * Refresh blockchain info
	 */
	async _refreshBlockchainInfo(): Promise<void> {
		const info = await this.rpcClient.getblockchaininfo();
		this.status.bitcoind.blocks = info.blocks;
		this.status.bitcoind.testnet = info.chain !== "main";
		this.status.bitcoind.up = true;
	}
}

export default new Status();

/*!
 * pushtx/status.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { createRpcClient } from "../lib/bitcoind-rpc/rpc-client.js";
import db from "../lib/db/mysql-db-wrapper.js";
import Logger from "../lib/logger.js";
import util from "../lib/util.js";

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

/**
 * Singleton providing information about the pushtx service
 */
class Status {
	constructor() {
		this.startTime = Date.now();
		this.status = JSON.parse(JSON.stringify(DEFAULT_STATUS));
		this.stats = {
			amount: 0,
			count: 0,
		};
		this.rpcClient = createRpcClient();
	}

	/**
	 * Update the stats
	 * @param {Number} amount - amount sent (in BTC)
	 */
	updateStats(amount) {
		this.stats.count++;
		this.stats.amount += amount;
	}

	/**
	 * Get current status
	 * @returns {Promise} status object
	 */
	async getCurrent() {
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
	async getScheduledTransactions() {
		const returnValue = {
			nbTxs: 0,
			txs: [],
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
	async _refreshNetworkInfo() {
		const info = await this.rpcClient.getnetworkinfo();
		this.status.bitcoind.conn = info.connections;
		this.status.bitcoind.version = info.version;
		this.status.bitcoind.protocolversion = info.protocolversion;
		this.status.bitcoind.relayfee = info.relayfee;
	}

	/**
	 * Refresh blockchain info
	 */
	async _refreshBlockchainInfo() {
		const info = await this.rpcClient.getblockchaininfo();
		this.status.bitcoind.blocks = info.blocks;
		this.status.bitcoind.testnet = info.chain !== "main";
		this.status.bitcoind.up = true;
	}
}

export default new Status();

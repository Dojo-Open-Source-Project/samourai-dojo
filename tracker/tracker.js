/*!
 * tracker/tracker.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import zmq from "zeromq/v5-compat.js";
import keysFile from "../keys/index.js";
import network from "../lib/bitcoin/network.js";
import util from "../lib/util.js";
import BlockchainProcessor from "./blockchain-processor.js";
import MempoolProcessor from "./mempool-processor.js";

const keys = keysFile[network.key];

/**
 * A class implementing a process tracking the blockchain
 */
class Tracker {
	/**
	 * Constructor
	 */
	constructor() {
		// Notification socket for client events
		this.notifSock = zmq.socket("pub");
		this.notifSock.bind(`tcp://127.0.0.1:${keys.ports.tracker}`, () => {
			// Initialize the blockchain processor
			// and the mempool buffer
			this.initialized = true;
			this.blockchainProcessor = new BlockchainProcessor(this.notifSock);
			this.mempoolProcessor = new MempoolProcessor(this.notifSock);
		});
	}

	/**
	 * Start the tracker
	 * @returns {Promise<void>}
	 */
	async start() {
		if (!this.initialized) {
			await util.delay(1000);

			return this.start();
		}

		await this.blockchainProcessor.start();
		await this.mempoolProcessor.start();
	}

	/**
	 * Stop the tracker
	 */
	async stop() {
		clearTimeout(this.startupTimeout);
		await this.blockchainProcessor.stop();
		await this.mempoolProcessor.stop();
	}
}

export default Tracker;

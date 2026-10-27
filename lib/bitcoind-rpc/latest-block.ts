/*!
 * lib/bitcoind_rpc/latest-block.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import zmq from "zeromq/v5-compat.js";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";
import util from "../util.js";
import {
	createRpcClient,
	type DojoRpcClient,
	waitForBitcoindRpcApi,
} from "./rpc-client.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * A singleton providing information about the latest block
 */
class LatestBlock {
	declare height: number | null;
	declare hash: string | null;
	declare time: number | null;
	declare diff: number | null;
	declare rpcClient: DojoRpcClient;
	declare sock: ReturnType<typeof zmq.socket>;
	/**
	 * Constructor
	 */
	constructor() {
		this.height = null;
		this.hash = null;
		this.time = null;
		this.diff = null;

		// Initialize the rpc client
		this.rpcClient = createRpcClient();

		waitForBitcoindRpcApi().then(() => {
			// Gets the latest block from bitcoind
			this.rpcClient
				.getbestblockhash()
				.then((hash?: string) => this.onBlockHash(hash));
		});

		// Initializes zmq socket
		this.sock = zmq.socket("sub");
		this.sock.connect(keys.bitcoind.zmqBlk);
		this.sock.subscribe("hashblock");

		this.sock.on("message", async (topic: Buffer, message: Buffer) => {
			switch (topic.toString()) {
				case "hashblock":
					await this.onBlockHash(message.toString("hex"));
					break;
				default:
					Logger.info(`Bitcoind RPC : ${topic.toString()}`);
			}
		});
	}

	/**
	 * Retrieve and store information for a given block
	 */
	async onBlockHash(hash?: string): Promise<void> {
		if (hash == null) return;
		try {
			const header = await this.rpcClient.getblockheader({ blockhash: hash });

			this.height = header.height;
			this.hash = hash;
			this.time = header.mediantime;
			this.diff = header.difficulty;

			Logger.info(`Bitcoind RPC : Block ${this.height} ${this.hash}`);
		} catch (error) {
			Logger.error(error, "Bitcoind RPC : LatestBlock.onBlockHash()");
			await util.delay(2000);
			return this.onBlockHash(hash);
		}
	}
}

export default new LatestBlock();

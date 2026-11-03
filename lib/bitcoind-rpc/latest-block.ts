/*!
 * lib/bitcoind_rpc/latest-block.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import zmq from "zeromq/v5-compat.js";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";
import {
	createRpcClient,
	type DojoRpcClient,
	waitForBitcoindRpcApi,
} from "./rpc-client.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

const RETRY_DELAYS = [2000, 4000];
const RECOVERY_DELAY = 30000;
const REQUEST_TIMEOUT = 10000;

// The RPC client exposes JSON-RPC errors as Error messages. Some HTTP errors
// lose their code, so unrecognized failures still get a bounded fast retry budget.
const isPermanentRpcError = (error: unknown): boolean => {
	if (!(error instanceof Error)) return false;
	if (error.message === "Invalid credentials") return true;
	const code = /^Code: (-?\d+),/.exec(error.message)?.[1];
	return (
		code != null && [-32600, -32601, -32602, -8, -5].includes(Number(code))
	);
};

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
	private running = false;
	private closed = false;
	private generation = 0;
	private lastNotification: string | undefined;
	private failures = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private request: AbortController | null = null;
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

		waitForBitcoindRpcApi()
			.then(() => this.requestRefresh())
			.catch((error: unknown) => {
				Logger.error(error, "Bitcoind RPC : LatestBlock startup");
				this.scheduleRefresh(RECOVERY_DELAY);
			});

		// Initializes zmq socket
		this.sock = zmq.socket("sub");
		this.sock.connect(keys.bitcoind.zmqBlk);
		this.sock.subscribe("hashblock");

		this.sock.on("message", (topic: Buffer, message: Buffer) => {
			switch (topic.toString()) {
				case "hashblock":
					this.onBlockHash(message.toString("hex"));
					break;
				default:
					Logger.info(`Bitcoind RPC : ${topic.toString()}`);
			}
		});
	}

	/**
	 * Notifications invalidate the cached tip; RPC determines the active chain.
	 */
	onBlockHash(hash?: string): void {
		if (this.closed || hash == null || hash === this.lastNotification) return;
		this.lastNotification = hash;
		this.generation++;
		this.requestRefresh();
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.timer != null) clearTimeout(this.timer);
		this.timer = null;
		this.request?.abort();
		this.sock.close();
	}

	private requestRefresh(): void {
		// Notifications cannot bypass an outage's shared backoff.
		if (this.closed || this.running || this.timer != null) return;
		this.refresh();
	}

	private scheduleRefresh(delay: number): void {
		if (this.closed || this.timer != null) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			this.requestRefresh();
		}, delay);
	}

	private async refresh(): Promise<void> {
		this.running = true;
		const generation = this.generation;
		const request = new AbortController();
		this.request = request;
		// Abort the transport itself rather than racing a still-running RPC call.
		const deadline = setTimeout(() => request.abort(), REQUEST_TIMEOUT);
		const options = { abortSignal: request.signal };
		try {
			const hash = await this.rpcClient.getbestblockhash(options);
			if (this.closed || generation !== this.generation) return;
			const header = await this.rpcClient.getblockheader(
				{ blockhash: hash },
				options,
			);
			if (this.closed || generation !== this.generation) return;

			// Never use height to determine freshness: reorgs may lower it.
			this.height = header.height;
			this.hash = hash;
			this.time = header.mediantime;
			this.diff = header.difficulty;
			this.failures = 0;

			Logger.info(`Bitcoind RPC : Block ${this.height} ${this.hash}`);
		} catch (error) {
			if (this.closed) return;
			Logger.error(error, "Bitcoind RPC : LatestBlock.refresh()");
			const delay = isPermanentRpcError(error)
				? RECOVERY_DELAY
				: (RETRY_DELAYS[this.failures] ?? RECOVERY_DELAY);
			this.failures++;
			this.scheduleRefresh(delay);
		} finally {
			clearTimeout(deadline);
			this.request = null;
			this.running = false;
			if (generation !== this.generation) this.requestRefresh();
		}
	}
}

export default new LatestBlock();

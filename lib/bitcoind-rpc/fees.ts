/*!
 * lib/bitcoind-rpc/fees.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { FeeEstimator, type FeeRates } from "@dojo-tools/next-block-estimator";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import errors from "../errors.js";
import Logger from "../logger.js";
import latestBlock from "./latest-block.js";
import {
	createRpcClient,
	type DojoRpcClient,
	type FeeEstimate,
	waitForBitcoindRpcApi,
} from "./rpc-client.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

type FeeTargets = 2 | 4 | 6 | 12 | 24;
type FeeMap = Record<FeeTargets, number>;

const isFeeEstimate = (value: unknown): value is FeeEstimate =>
	value != null && typeof value === "object";

/**
 * A singleton providing information about network fees
 */
class Fees {
	declare block: number;
	declare fees: FeeMap;
	declare feeType: string;
	declare timer: ReturnType<typeof setTimeout> | null;
	declare rpcClient: DojoRpcClient;
	private estimator: FeeEstimator | undefined;
	private estimatorFees: FeeRates | null = null;
	private closed = false;
	constructor() {
		this.block = -1;
		this.fees = {
			2: 1,
			4: 1,
			6: 1,
			12: 1,
			24: 1,
		};

		this.feeType = keys.bitcoind.feeType;
		this.timer = null;

		this.rpcClient = createRpcClient();

		void waitForBitcoindRpcApi()
			.then(() => {
				if (this.closed) return;
				void this.refresh();
				this.estimator = new FeeEstimator({
					mode: "txs",
					refresh: 20,
					useWorker: true,
					rpcOptions: {
						protocol: "http",
						host: keys.bitcoind.rpc.host,
						port: keys.bitcoind.rpc.port,
						username: keys.bitcoind.rpc.user,
						password: keys.bitcoind.rpc.pass,
					},
				});
				this.estimator.on("error", (error: unknown) => {
					Logger.error(error, "Estimator : Received estimator error");
				});
				this.estimator.on("data", (result) => {
					if (!result.ready) return;
					this.estimatorFees = result.fees;
				});
			})
			.catch((error: unknown) => {
				Logger.error(error, "Fees : Failed to start fee estimator");
			});
	}

	/**
	 * Refresh and return the current fees
	 */
	async getFees() {
		try {
			if ((latestBlock.height ?? -1) > this.block) await this.refresh();

			return this.fees;
		} catch {
			throw errors.generic.GEN;
		}
	}

	/**
	 * Get fee rates calculated by $1 Fee Estimator
	 * @throws {string} - Throw error until the first estimate arrives
	 */
	getEstimatorFees() {
		if (!this.estimatorFees) throw errors.estimator.NOT_AVAILABLE;
		return this.estimatorFees;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.timer != null) clearTimeout(this.timer);
		this.estimator?.stop();
	}

	/**
	 * Refresh the current fees
	 */
	async refresh() {
		if (this.timer != null) clearTimeout(this.timer);

		try {
			const requests = Object.keys(this.fees)
				.map(Number)
				.map((target) => {
					return {
						method: "estimatesmartfee",
						params: { conf_target: target, estimate_mode: this.feeType },
						id: target,
					};
				});
			const responses = await this.rpcClient.batch(requests);

			for (const fee of responses) {
				if (!("result" in fee) || !isFeeEstimate(fee.result)) continue;
				const result = fee.result;
				const errors = Array.isArray(result.errors) && result.errors.length > 0;
				const feerate =
					errors || typeof result.feerate !== "number"
						? 1
						: Math.round(result.feerate * 1e5);
				// add 1 to feerate if the feerate is larger than 1 to avoid underpaying
				this.fees[fee.id as FeeTargets] = feerate === 1 ? feerate : feerate + 1;
			}
		} catch (error) {
			Logger.error(error, "Bitcoind RPC : Fees.refresh()");
		}
		this.block = latestBlock.height ?? this.block;
		// Make this method refresh fees at least every minute
		if (!this.closed) this.timer = setTimeout(() => this.refresh(), 60000); // 1 MINUTE
	}
}

export default new Fees();

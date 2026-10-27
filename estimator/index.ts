/*!
 * lib/bitcoind-rpc/fees.js
 * Copyright © 2023 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { FeeEstimator } from "@dojo-tools/next-block-estimator";
import keysFile from "../keys/index.js";
import network from "../lib/bitcoin/network.js";
import { waitForBitcoindRpcApi } from "../lib/bitcoind-rpc/rpc-client.js";
import { coordinator } from "../lib/coordination/client.js";
import Logger from "../lib/logger.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

interface EstimatorResult {
	ready?: boolean;
	fees?: Record<string, unknown>;
}

try {
	await waitForBitcoindRpcApi();

	const estimator = new FeeEstimator({
		mode: "txs",
		refresh: 20,
		rpcOptions: {
			host: keys.bitcoind.rpc.host,
			port: keys.bitcoind.rpc.port,
			username: keys.bitcoind.rpc.user,
			password: keys.bitcoind.rpc.pass,
		},
	});

	// handle errors emitted by FeeEstimator
	estimator.on("error", (error?: unknown) => {
		Logger.error(error, "Estimator : Received estimator error");
	});

	let feeSequence = 0;
	// receive live fee rate updates from the FeeEstimator
	estimator.on("data", (result: EstimatorResult) => {
		if (result.ready === false)
			Logger.info(
				"Estimator : Mempool not fully loaded. Feerates might be unreliable.",
			);
		Logger.info(
			`Estimator : Received new fee estimates: ${JSON.stringify(result.fees)}`,
		);
		void coordinator
			.request("fees.publish", {
				update: result,
				sequence: ++feeSequence,
			})
			.catch((error) => {
				Logger.error(error, "Estimator : Failed to publish fee estimates");
			});
	});

	// Signal that the process is ready
	process.send("ready");

	const exit = () => {
		estimator.stop();
		coordinator.close();
		process.exit(0);
	};

	process.on("SIGTERM", () => {
		exit();
	});

	process.on("SIGINT", () => {
		exit();
	});
} catch (error) {
	Logger.error(error, "Estimator : Unhandled error, exiting...");
	process.exit(1);
}

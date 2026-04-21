/*!
 * tracker/index.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../keys/index.js";
import network from "../lib/bitcoin/network.js";
import { waitForBitcoindRpcApi } from "../lib/bitcoind-rpc/rpc-client.js";
import db from "../lib/db/mysql-db-wrapper.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import Tracker from "./tracker.js";
import TrackerRestApi from "./tracker-rest-api.js";

const keys = keysFile[network.key];

try {
	Logger.info(`Tracker : Process ID: ${process.pid}`);
	Logger.info("Tracker : Preparing the tracker");

	// Wait for Bitcoind RPC API
	// being ready to process requests
	await waitForBitcoindRpcApi();

	// Initialize the db wrapper
	const dbConfig = {
		connectionLimit: keys.db.connectionLimitTracker,
		acquireTimeout: keys.db.acquireTimeout,
		host: keys.db.host,
		user: keys.db.user,
		password: keys.db.pass,
		database: keys.db.database,
	};

	db.connect(dbConfig);

	// Initialize the tracker
	const tracker = new Tracker();

	// Initialize the http server
	const host = keys.apiBind;
	const port = keys.ports.trackerApi;
	const httpServer = new HttpServer(port, host);

	// Initialize the rest api endpoints
	new TrackerRestApi(httpServer, tracker);

	// Start the http server
	httpServer.start();

	// Start the tracker
	tracker.start();

	// Signal that the process is ready
	process.send("ready");

	const exit = async () => {
		httpServer.stop();
		await tracker.stop();
		await db.disconnect();
		process.exit(0);
	};

	process.on("SIGTERM", async () => {
		await exit();
	});

	process.on("SIGINT", async () => {
		await exit();
	});
} catch (error) {
	Logger.error(error, "Tracker : Unhandled error, exiting...");
	process.exit(1);
}

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type CoordinatorConnection, isRecord } from "./protocol.js";

export function coordinatorDirectory(): string {
	const network = process.env.COMMON_BTC_NETWORK ?? "mainnet";
	if (network !== "mainnet" && network !== "testnet")
		throw new Error("Unsupported coordinator network");
	return path.resolve(
		process.env.DOJO_COORDINATOR_DIR ??
			path.join(homedir(), ".dojo", "coordination"),
		network,
	);
}

export function coordinatorConnection(): CoordinatorConnection {
	const endpoint = process.env.DOJO_COORDINATOR_ENDPOINT;
	const epoch = process.env.DOJO_COORDINATOR_EPOCH;
	if ((endpoint === undefined) !== (epoch === undefined))
		throw new Error(
			"Coordinator endpoint and epoch must be configured together",
		);
	const value: unknown =
		endpoint && epoch
			? { endpoint, epoch }
			: JSON.parse(
					readFileSync(
						path.join(coordinatorDirectory(), "connection.json"),
						"utf8",
					),
				);
	if (
		!isRecord(value) ||
		typeof value.endpoint !== "string" ||
		!value.endpoint.startsWith("ipc:///") ||
		typeof value.epoch !== "string" ||
		value.epoch.length === 0
	)
		throw new Error(
			"Invalid coordinator connection; start the Dojo supervisor first",
		);
	return { endpoint: value.endpoint, epoch: value.epoch };
}

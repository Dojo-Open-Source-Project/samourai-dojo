import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CoordinatorClient } from "../../../lib/coordination/client.js";
import { isRecord } from "../../../lib/coordination/protocol.js";

function waitForMessage(
	child: ChildProcess,
	type: string,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const receive = (message: unknown) => {
			if (isRecord(message) && message.type === type) {
				cleanup();
				resolve(message);
			}
		};
		const failed = () => {
			cleanup();
			reject(new Error(`Coordinator exited before ${type}`));
		};
		const cleanup = () => {
			clearTimeout(timeout);
			child.removeListener("message", receive);
			child.removeListener("exit", failed);
		};
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Timed out waiting for ${type}`));
		}, 3000);
		child.on("message", receive);
		child.once("exit", failed);
	});
}

describe("Coordinator process", function () {
	this.timeout(8000);
	let directory: string;
	let server: ChildProcess;
	let client: CoordinatorClient;
	let epoch: string;
	let acknowledgeOwners: boolean;
	let registered: number[];

	beforeEach(async () => {
		directory = await mkdtemp(path.join(tmpdir(), "dojo-"));
		const endpoint = `ipc://${path.join(directory, "rpc.sock")}`;
		epoch = randomUUID();
		acknowledgeOwners = true;
		registered = [];
		server = fork(
			fileURLToPath(
				new URL("../../../lib/coordination/server.js", import.meta.url),
			),
			[],
			{
				env: {
					...process.env,
					DOJO_COORDINATOR_ENDPOINT: endpoint,
					DOJO_COORDINATOR_EPOCH: epoch,
				},
				stdio: ["ignore", "ignore", "inherit", "ipc"],
			},
		);
		server.on("message", (message: unknown) => {
			if (isRecord(message) && message.type === "owners") {
				registered = message.pids as number[];
				if (acknowledgeOwners)
					server.send({ type: "owners-ack", epoch, id: message.id });
			}
		});
		await waitForMessage(server, "ready");
		client = new CoordinatorClient({ endpoint, epoch });
	});

	afterEach(async () => {
		client?.close();
		if (server && server.exitCode === null && server.signalCode === null) {
			const exited = once(server, "exit");
			server.kill("SIGTERM");
			if (server.connected) server.disconnect();
			const force = setTimeout(() => server.kill("SIGKILL"), 1000);
			try {
				await exited;
			} finally {
				clearTimeout(force);
			}
		}
		if (directory) await rm(directory, { recursive: true, force: true });
	});

	it("does not grant a claim until the launcher acknowledges its owner", async () => {
		acknowledgeOwners = false;
		const announced = waitForMessage(server, "owners");
		let granted = false;
		const claim = client
			.request("import.claim", {
				key: "xpub",
				token: "token",
				progress: true,
			})
			.then((value) => {
				granted = value;
				return value;
			});
		const owners = await announced;
		assert.deepEqual(registered, [process.pid]);
		assert.equal(granted, false);
		server.send({ type: "owners-ack", epoch, id: owners.id });
		assert.equal(await claim, true);
		acknowledgeOwners = true;
		assert.equal(
			await client.request("import.release", { key: "xpub", token: "token" }),
			true,
		);
		assert.deepEqual(registered, []);
	});

	it("drains new work while allowing current owners to release their claims", async () => {
		await client.request("import.claim", {
			key: "xpub",
			token: "token",
			progress: true,
		});
		const drained = waitForMessage(server, "drained");
		server.send({ type: "drain", epoch });
		await drained;
		await assert.rejects(
			client.request("import.claim", {
				key: "another-xpub",
				token: "another-token",
				progress: true,
			}),
			/shutting down/,
		);
		await assert.rejects(
			client.request("nonce.create", { nonce: "nonce" }),
			/shutting down/,
		);
		assert.equal(
			await client.request("import.release", { key: "xpub", token: "token" }),
			true,
		);
		assert.deepEqual(registered, []);
	});
});

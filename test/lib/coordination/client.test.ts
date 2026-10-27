import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Router } from "zeromq";
import {
	CoordinatorClient,
	CoordinatorError,
} from "../../../lib/coordination/client.js";
import { isRecord } from "../../../lib/coordination/protocol.js";
import { CoordinatorState } from "../../../lib/coordination/state.js";

describe("Coordinator RPC", function () {
	this.timeout(8000);
	let router: Router;
	let clients: CoordinatorClient[];
	let loop: Promise<void>;
	let endpoint: string;
	let dropConsumeReply: boolean;

	beforeEach(async () => {
		endpoint = `inproc://dojo-coordination-${randomUUID()}`;
		router = new Router({ linger: 0, sendTimeout: 0 });
		await router.bind(endpoint);
		clients = [];
		dropConsumeReply = false;
		const state = new CoordinatorState("test-session");
		loop = (async () => {
			try {
				for await (const [identity, message] of router) {
					const input: unknown = JSON.parse(message.toString());
					const response = state.handle(input, identity.toString("hex"));
					if (
						dropConsumeReply &&
						isRecord(input) &&
						input.op === "nonce.consume"
					) {
						dropConsumeReply = false;
						continue;
					}
					await router.send([identity, JSON.stringify(response)]);
				}
			} catch (error) {
				if (!router.closed) throw error;
			}
		})();
	});

	afterEach(async () => {
		for (const client of clients) client.close();
		router.close();
		await loop;
	});

	function client(epoch = "test-session"): CoordinatorClient {
		const value = new CoordinatorClient({ endpoint, epoch });
		clients.push(value);
		return value;
	}

	it("arbitrates concurrent claims from independent clients", async () => {
		const first = client();
		const second = client();
		const results = await Promise.all([
			first.request("import.claim", {
				key: "xpub",
				token: "one",
				progress: true,
			}),
			second.request("import.claim", {
				key: "xpub",
				token: "two",
				progress: true,
			}),
		]);
		assert.equal(results.filter(Boolean).length, 1);
		assert.equal(await first.request("import.get", { key: "xpub" }), true);
	});

	it("retries a lost reply without consuming a nonce twice", async () => {
		const first = client();
		const second = client();
		await first.request("nonce.create", { nonce: "nonce" });
		await second.request("nonce.approve", { nonce: "nonce" });
		dropConsumeReply = true;
		assert.equal(
			await first.request("nonce.consume", { nonce: "nonce" }),
			"approved",
		);
		assert.equal(
			await second.request("nonce.consume", { nonce: "nonce" }),
			"missing",
		);
	});

	it("rejects clients carrying an old coordinator epoch", async () => {
		await assert.rejects(
			client("old-session").request("ping", {}),
			CoordinatorError,
		);
	});

	it("rejects pending work when the client is closed", async () => {
		const first = client();
		const pending = first.request("ping", {});
		const rejected = assert.rejects(pending, CoordinatorError);
		first.close();
		await rejected;
	});
});

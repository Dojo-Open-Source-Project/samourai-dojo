import assert from "node:assert/strict";
import {
	FEE_PERCENTILES,
	FEE_TTL_MS,
	NONCE_TTL_MS,
	type Operation,
	type Operations,
	REQUEST_TIMEOUT_MS,
	type RpcRequest,
} from "../../../lib/coordination/protocol.js";
import { CoordinatorState } from "../../../lib/coordination/state.js";

function fixture() {
	let now = 1000000;
	let sequence = 0;
	const owners = new Set([101, 102]);
	const state = new CoordinatorState("session-one", (pid) => owners.has(pid));
	function request<K extends Operation>(
		op: K,
		args: Operations[K]["args"],
		pid = 101,
	): RpcRequest {
		return {
			version: 1,
			id: String(++sequence),
			epoch: state.epoch,
			pid,
			deadline: now + REQUEST_TIMEOUT_MS,
			op,
			args,
		};
	}
	function call<K extends Operation>(
		op: K,
		args: Operations[K]["args"],
		pid = 101,
	): Operations[K]["result"] {
		const reply = state.handle(request(op, args, pid), String(pid), now);
		assert.equal(reply.ok, true, reply.error);
		return reply.value as Operations[K]["result"];
	}
	return {
		state,
		owners,
		request,
		call,
		time: () => now,
		advance: (milliseconds: number) => {
			now += milliseconds;
		},
	};
}

describe("Coordinator state", () => {
	it("shares pending nonces and consumes an approved nonce once across workers", () => {
		const f = fixture();
		assert.equal(
			f.call("nonce.create", { nonce: "nonce" }),
			f.time() + NONCE_TTL_MS,
		);
		assert.equal(f.call("nonce.consume", { nonce: "nonce" }, 102), "pending");
		assert.equal(f.call("nonce.approve", { nonce: "nonce" }, 102), true);
		assert.equal(f.call("nonce.consume", { nonce: "nonce" }), "approved");
		assert.equal(f.call("nonce.consume", { nonce: "nonce" }, 102), "missing");
		assert.equal(f.call("nonce.approve", { nonce: "nonce" }), false);
	});

	it("does not extend nonce expiry when approval arrives", () => {
		const f = fixture();
		f.call("nonce.create", { nonce: "nonce" });
		f.advance(NONCE_TTL_MS - 1);
		f.call("nonce.approve", { nonce: "nonce" });
		f.advance(1);
		assert.equal(f.call("nonce.consume", { nonce: "nonce" }), "missing");
	});

	it("replays a lost consume reply without allowing another request to consume", () => {
		const f = fixture();
		f.call("nonce.create", { nonce: "nonce" });
		f.call("nonce.approve", { nonce: "nonce" });
		const request = f.request("nonce.consume", { nonce: "nonce" });
		const original = f.state.handle(request, "101", f.time());
		assert.equal(original.value, "approved");
		assert.deepEqual(f.state.handle(request, "101", f.time()), original);
		assert.equal(f.call("nonce.consume", { nonce: "nonce" }, 102), "missing");
		const otherClient = f.state.handle(request, "different-client", f.time());
		assert.equal(otherClient.value, "missing");
	});

	it("rejects changed payloads with the same request ID", () => {
		const f = fixture();
		const request = f.request("ping", {});
		f.state.handle(request, "101", f.time());
		const changed = {
			...request,
			op: "nonce.create",
			args: { nonce: "nonce" },
		};
		assert.equal(f.state.handle(changed, "101", f.time()).ok, false);
		assert.equal(f.call("nonce.consume", { nonce: "nonce" }), "missing");
	});

	it("rejects expired requests and requests from an earlier coordinator", () => {
		const f = fixture();
		const request = f.request("import.claim", {
			key: "xpub",
			token: "token",
			progress: true,
		});
		assert.equal(
			f.state.handle({ ...request, deadline: f.time() }, "101", f.time()).ok,
			false,
		);
		assert.equal(
			f.state.handle({ ...request, epoch: "previous-session" }, "101", f.time())
				.ok,
			false,
		);
		assert.equal(f.call("import.get", { key: "xpub" }), null);
	});

	it("grants an import to one worker and checks both owner and token", () => {
		const f = fixture();
		const args = {
			key: "xpub",
			token: "first",
			progress: { status: "rescan" },
		};
		assert.equal(f.call("import.claim", args), true);
		assert.equal(
			f.call("import.claim", { ...args, token: "second" }, 102),
			false,
		);
		assert.deepEqual(f.call("import.get", { key: "xpub" }, 102), {
			status: "rescan",
		});
		assert.equal(
			f.call("import.release", { key: "xpub", token: "first" }, 102),
			false,
		);
		assert.equal(
			f.call("import.release", { key: "xpub", token: "wrong" }),
			false,
		);
		assert.equal(
			f.call("import.update", {
				key: "xpub",
				token: "first",
				progress: { status: "import", txs: 4 },
			}),
			true,
		);
		assert.deepEqual(f.call("import.get", { key: "xpub" }, 102), {
			status: "import",
			txs: 4,
		});
		assert.equal(
			f.call("import.release", { key: "xpub", token: "first" }),
			true,
		);
		assert.equal(
			f.call("import.claim", { ...args, token: "second" }, 102),
			true,
		);
		assert.equal(
			f.call("import.release", { key: "xpub", token: "first" }),
			false,
		);
	});

	it("keeps a slow owner's claim and reclaims it only after confirmed death", () => {
		const f = fixture();
		f.call("import.claim", { key: "address", token: "first", progress: true });
		f.advance(60 * 60 * 1000);
		f.state.sweep(f.time());
		assert.equal(
			f.call(
				"import.claim",
				{
					key: "address",
					token: "second",
					progress: true,
				},
				102,
			),
			false,
		);
		f.owners.delete(101);
		assert.equal(
			f.call(
				"import.claim",
				{
					key: "address",
					token: "second",
					progress: true,
				},
				102,
			),
			true,
		);
		assert.equal(
			f.call("import.release", { key: "address", token: "first" }),
			false,
		);
	});

	it("gives a new reader the latest fee snapshot, then expires it", () => {
		const f = fixture();
		const fees = Object.fromEntries(
			FEE_PERCENTILES.map((key, index) => [key, index + 1]),
		);
		assert.equal(f.call("fees.get", {}), null);
		f.call("fees.publish", { update: { ready: true, fees }, sequence: 1 });
		assert.deepEqual(f.call("fees.get", {}, 102)?.fees, fees);
		f.advance(FEE_TTL_MS);
		assert.equal(f.call("fees.get", {}, 102), null);
		f.call("fees.publish", { update: { ready: true, fees }, sequence: 2 });
		f.call("fees.publish", { update: { ready: false }, sequence: 3 });
		assert.equal(f.call("fees.get", {}, 102), null);
	});

	it("rejects invalid progress before changing an existing claim", () => {
		const f = fixture();
		f.call("import.claim", { key: "xpub", token: "token", progress: true });
		const request = f.request("import.update", {
			key: "xpub",
			token: "token",
			progress: { txs: -1 },
		});
		assert.equal(f.state.handle(request, "101", f.time()).ok, false);
		assert.equal(f.call("import.get", { key: "xpub" }), true);
	});

	it("does not let a delayed fee update replace a newer snapshot", () => {
		const f = fixture();
		const fees = Object.fromEntries(FEE_PERCENTILES.map((key) => [key, 4]));
		f.call("fees.publish", { update: { ready: true, fees }, sequence: 2 });
		assert.equal(
			f.call("fees.publish", {
				update: { ready: false },
				sequence: 1,
			}),
			false,
		);
		assert.deepEqual(f.call("fees.get", {})?.fees, fees);
		const competing = f.request(
			"fees.publish",
			{
				update: { ready: true, fees },
				sequence: 1,
			},
			102,
		);
		assert.equal(f.state.handle(competing, "102", f.time()).ok, false);
		f.owners.delete(101);
		assert.equal(f.call("fees.get", {}), null);
		assert.equal(
			f.call(
				"fees.publish",
				{
					update: { ready: true, fees },
					sequence: 1,
				},
				102,
			),
			true,
		);
	});

	it("never applies a queued mutation once its deadline has passed", () => {
		const f = fixture();
		const request = f.request("import.claim", {
			key: "xpub",
			token: "token",
			progress: true,
		});
		f.advance(REQUEST_TIMEOUT_MS + 1);
		assert.equal(f.state.handle(request, "101", f.time()).ok, false);
		assert.equal(f.call("import.get", { key: "xpub" }), null);
	});
});

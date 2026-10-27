import assert from "node:assert/strict";
import { Auth47Nonces, NONCE_TTL_MS } from "../../../lib/auth/auth47-nonces.js";

function fixture() {
	let now = 1000000;
	return {
		nonces: new Auth47Nonces(() => now),
		time: () => now,
		advance: (milliseconds: number) => {
			now += milliseconds;
		},
	};
}

describe("Auth47 nonces", () => {
	it("creates a pending challenge with a ten-minute expiry", () => {
		const f = fixture();
		const { nonce, expiresAt } = f.nonces.create();
		assert.match(nonce, /^[0-9a-f]{24}$/);
		assert.equal(expiresAt, f.time() + NONCE_TTL_MS);
		assert.equal(f.nonces.consume(nonce), "pending");
		assert.equal(f.nonces.consume(nonce), "pending");
	});

	it("allows an approved challenge to authorize only one status request", () => {
		const { nonces } = fixture();
		const { nonce } = nonces.create();
		assert.equal(nonces.approve(nonce), true);
		assert.equal(nonces.consume(nonce), "approved");
		assert.equal(nonces.consume(nonce), "missing");
		assert.equal(nonces.approve(nonce), false);
	});

	it("rejects unknown and expired challenges", () => {
		const f = fixture();
		assert.equal(f.nonces.approve("unknown"), false);
		assert.equal(f.nonces.consume("unknown"), "missing");
		const first = f.nonces.create();
		const second = f.nonces.create();
		f.advance(NONCE_TTL_MS);
		assert.equal(f.nonces.approve(first.nonce), false);
		assert.equal(f.nonces.consume(second.nonce), "missing");
	});

	it("does not extend a challenge's expiry when it is approved again", () => {
		const f = fixture();
		const { nonce } = f.nonces.create();
		assert.equal(f.nonces.approve(nonce), true);
		f.advance(NONCE_TTL_MS - 1);
		assert.equal(f.nonces.approve(nonce), true);
		f.advance(1);
		assert.equal(f.nonces.consume(nonce), "missing");
	});

	it("bounds pending challenges and frees capacity after consumption or expiry", () => {
		const f = fixture();
		const first = f.nonces.create();
		for (let i = 1; i < 1000; i++) f.nonces.create();
		assert.throws(() => f.nonces.create(), /Too many pending/);
		f.nonces.approve(first.nonce);
		assert.equal(f.nonces.consume(first.nonce), "approved");
		assert.doesNotThrow(() => f.nonces.create());
		assert.throws(() => f.nonces.create(), /Too many pending/);
		f.advance(NONCE_TTL_MS);
		assert.doesNotThrow(() => f.nonces.create());
	});
});

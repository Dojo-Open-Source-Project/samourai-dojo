import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { Auth47Nonces, NONCE_TTL_MS } from "../../../lib/auth/auth47-nonces.js";

function fixture() {
	return {
		nonces: new Auth47Nonces(),
		time: () => Date.now(),
		advance: (milliseconds: number) => {
			vi.advanceTimersByTime(milliseconds);
		},
	};
}

describe("Auth47 nonces", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1000000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

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

	it("evicts the oldest challenges when new ones exceed capacity", () => {
		const { nonces } = fixture();
		const challenges = Array.from({ length: 1000 }, () => nonces.create());
		assert.equal(nonces.consume(challenges[0].nonce), "pending");
		assert.equal(nonces.approve(challenges[0].nonce), true);
		const newest = Array.from({ length: 1000 }, () => nonces.create());
		for (const { nonce } of challenges)
			assert.equal(nonces.consume(nonce), "missing");
		assert.equal(nonces.approve(challenges[0].nonce), false);
		for (const { nonce } of newest)
			assert.equal(nonces.consume(nonce), "pending");
	});

	it("frees capacity after consumption or expiry", () => {
		const f = fixture();
		const first = f.nonces.create();
		const second = f.nonces.create();
		for (let i = 2; i < 1000; i++) f.nonces.create();
		f.nonces.approve(first.nonce);
		assert.equal(f.nonces.consume(first.nonce), "approved");
		f.nonces.create();
		assert.equal(f.nonces.consume(second.nonce), "pending");
		f.advance(NONCE_TTL_MS);
		const fresh = f.nonces.create();
		assert.equal(f.nonces.consume(second.nonce), "missing");
		assert.equal(f.nonces.consume(fresh.nonce), "pending");
	});
});

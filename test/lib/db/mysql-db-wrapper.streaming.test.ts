import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { Pool } from "mariadb";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import db from "../../../lib/db/mysql-db-wrapper.js";
import Logger from "../../../lib/logger.js";
import util from "../../../lib/util.js";

function streamingDriver(
	...rowSets: (Iterable<object> | AsyncIterable<object>)[]
) {
	const connections = rowSets.map((rows) => {
		const stream = Object.assign(Readable.from(rows), { close: vi.fn() });
		return {
			stream,
			queryStream: vi.fn(() => stream),
			release: vi.fn(async () => {}),
		};
	});
	let next = 0;
	const pool = { getConnection: vi.fn(async () => connections[next++]) };
	db.pool = pool as unknown as Pool;
	return {
		stream: connections[0].stream,
		connection: connections[0],
		connections,
		pool,
	};
}

beforeEach(() => {
	vi.spyOn(Logger, "error").mockImplementation(() => {});
	vi.spyOn(util, "delay").mockResolvedValue(undefined);
});

afterEach(() => {
	db.pool = null;
	vi.restoreAllMocks();
});

describe("Streaming database reads", () => {
	it.each(["ER_LOCK_DEADLOCK", "ER_LOCK_TIMEOUT", "ER_LOCK_WAIT_TIMEOUT"])(
		"discards partially grouped rows and returns the connection before retrying %s",
		async (code) => {
			const error = Object.assign(new Error("locked"), { code });
			async function* partialRows(): AsyncGenerator<object> {
				yield { hdXpub: null, addrID: 1, addrAddress: "discarded" };
				throw error;
			}
			const { connections } = streamingDriver(partialRows(), [
				{ hdXpub: null, addrID: 2, addrAddress: "complete" },
			]);
			connections[1].queryStream.mockImplementation(() => {
				assert.equal(connections[0].release.mock.calls.length, 1);
				return connections[1].stream;
			});
			assert.deepEqual(
				await db.getHDAccountsByAddresses(["discarded", "complete"]),
				{ hd: {}, loose: [{ addrID: 2, addrAddress: "complete" }] },
			);
			for (const connection of connections) {
				assert.equal(connection.stream.close.mock.calls.length, 1);
				assert.equal(connection.release.mock.calls.length, 1);
			}
		},
	);

	it("rejects a failed stream without exposing its partial result", async () => {
		const error = new Error("connection lost");
		async function* rows() {
			yield { addrAddress: "partial", addrID: 1 };
			throw error;
		}
		const { connection, stream, pool } = streamingDriver(rows());
		await assert.rejects(db.getAddressesIds(["partial"]), (e) => e === error);
		assert.equal(stream.close.mock.calls.length, 1);
		assert.equal(connection.release.mock.calls.length, 1);
		assert.equal(pool.getConnection.mock.calls.length, 1);
	});

	it("bounds lock retries even after partial rows have arrived", async () => {
		const error = Object.assign(new Error("locked"), {
			code: "ER_LOCK_DEADLOCK",
		});
		async function* rows() {
			yield { addrAddress: "partial", addrID: 1 };
			throw error;
		}
		const { connections, pool } = streamingDriver(
			...Array.from({ length: 6 }, () => rows()),
		);
		await assert.rejects(db.getAddressesIds(["partial"]), (e) => e === error);
		assert.equal(pool.getConnection.mock.calls.length, 6);
		assert.equal(vi.mocked(util.delay).mock.calls.length, 5);
		for (const connection of connections)
			assert.equal(connection.release.mock.calls.length, 1);
	});

	it("returns the connection when creating a stream throws", async () => {
		const error = new Error("cannot start query");
		const { connection } = streamingDriver([]);
		connection.queryStream.mockImplementation(() => {
			throw error;
		});
		await assert.rejects(db.getTransactionsIds(["txid"]), (e) => e === error);
		assert.equal(connection.release.mock.calls.length, 1);
	});

	it("closes the stream and returns the connection if row processing throws", async () => {
		const error = new Error("cannot read row");
		const { connection, stream } = streamingDriver([
			{
				get addrAddress() {
					throw error;
				},
				addrID: 1,
			},
		]);
		await assert.rejects(db.getAddressesIds(["address"]), (e) => e === error);
		assert.equal(stream.close.mock.calls.length, 1);
		assert.equal(connection.release.mock.calls.length, 1);
	});

	it("propagates pool acquisition failures", async () => {
		const error = new Error("pool unavailable");
		const { connection, pool } = streamingDriver([]);
		pool.getConnection.mockRejectedValueOnce(error);
		await assert.rejects(db.getAddressesIds(["address"]), (e) => e === error);
		assert.equal(connection.release.mock.calls.length, 0);
	});

	it("returns empty lookup results without acquiring a connection", async () => {
		const { pool } = streamingDriver([]);
		assert.deepEqual(await db.getAddressesIds(), {});
		assert.deepEqual(await db.getTransactionsIds(), {});
		assert.deepEqual(await db.getXpubByAddresses(), {});
		assert.deepEqual(await db.getHDAccountsByAddresses(), {
			hd: {},
			loose: [],
		});
		assert.equal(pool.getConnection.mock.calls.length, 0);
	});
	it("assembles a transaction page from streamed rows while preserving equal-time ordering", async () => {
		const { pool } = streamingDriver([
			{
				txnID: 1,
				inIndex: 0,
				inSequence: 7,
				inOutTxid: "parent",
				inOutIndex: 0,
				inOutAmount: 7,
				inOutAddress: "from",
			},
			{ txnID: 1, inIndex: null, outIndex: 0, outAmount: 5, outAddress: "to" },
			{
				txnID: 99,
				inIndex: null,
				outIndex: 0,
				outAmount: 100,
				outAddress: "ignored",
			},
		]);
		Object.assign(pool, {
			query: vi.fn().mockResolvedValueOnce([
				[
					{
						txnID: 2,
						txnTxid: "second",
						time: 200,
						txnVersion: 1,
						txnLocktime: 0,
						blockHeight: null,
					},
					{
						txnID: 1,
						txnTxid: "first",
						time: 200,
						txnVersion: 2,
						txnLocktime: 3,
						blockHeight: 10,
					},
				],
				[],
			]),
		});
		assert.deepEqual(await db.getTxsByAddrAndXpubs(["address"], [], 0, 2), [
			{
				hash: "second",
				time: 200,
				version: 1,
				locktime: 0,
				result: 0,
				inputs: [],
				out: [],
			},
			{
				hash: "first",
				time: 200,
				version: 2,
				locktime: 3,
				block_height: 10,
				result: -2,
				inputs: [
					{
						vin: 0,
						sequence: 7,
						prev_out: { txid: "parent", vout: 0, value: 7, addr: "from" },
					},
				],
				out: [{ n: 0, value: 5, addr: "to" }],
			},
		]);
	});
	it("assembles transaction responses from separate output and input streams", async () => {
		const { connections } = streamingDriver(
			[
				{
					txnVersion: 2,
					txnLocktime: 10,
					txnCreated: 100,
					blockTime: null,
					blockHeight: null,
					outIndex: 0,
					outAmount: 42,
					addrAddress: "address",
					outScript: "script",
					hdXpub: null,
				},
			],
			[],
		);
		assert.deepEqual(await db.getTransaction("txid"), {
			hash: "txid",
			time: 100,
			version: 2,
			locktime: 10,
			inputs: [],
			out: [{ n: 0, value: 42, addr: "address", script: "script" }],
		});
		for (const connection of connections)
			assert.equal(connection.release.mock.calls.length, 1);
	});
	it("groups streamed HD rows while retaining address order and loose entries", async () => {
		streamingDriver([
			{
				hdXpub: "xpub",
				hdID: 2,
				hdType: 44,
				addrID: 8,
				addrAddress: "first",
				hdAddrChain: 0,
				hdAddrIndex: 1,
			},
			{ hdXpub: null, addrID: 9, addrAddress: "loose" },
			{
				hdXpub: "xpub",
				hdID: 2,
				hdType: 44,
				addrID: 10,
				addrAddress: "last",
				hdAddrChain: 1,
				hdAddrIndex: 2,
			},
		]);
		assert.deepEqual(
			await db.getHDAccountsByAddresses(["first", "loose", "last"]),
			{
				hd: {
					xpub: {
						hdID: 2,
						hdType: 44,
						addresses: [
							{
								addrID: 8,
								addrAddress: "first",
								hdAddrChain: 0,
								hdAddrIndex: 1,
							},
							{
								addrID: 10,
								addrAddress: "last",
								hdAddrChain: 1,
								hdAddrIndex: 2,
							},
						],
					},
				},
				loose: [{ addrID: 9, addrAddress: "loose" }],
			},
		);
	});
	it("builds address ownership maps directly from rows", async () => {
		streamingDriver([
			{ addrAddress: "owned", hdXpub: "xpub-a" },
			{ addrAddress: "shared", hdXpub: "xpub-a" },
			{ addrAddress: "shared", hdXpub: "xpub-b" },
		]);
		assert.deepEqual(await db.getXpubByAddresses(["owned", "shared"]), {
			owned: "xpub-a",
			shared: "xpub-b",
		});
	});
	it("builds transaction ID maps without buffering the query result", async () => {
		streamingDriver([
			{ txnTxid: "first", txnID: 7 },
			{ txnTxid: "second", txnID: 9 },
		]);
		assert.deepEqual(await db.getTransactionsIds(["first", "second"]), {
			first: 7,
			second: 9,
		});
	});
	it("builds address ID maps from a streaming connection and returns it to the pool", async () => {
		const { stream, connection } = streamingDriver([
			{ addrAddress: "first", addrID: 3 },
			{ addrAddress: "second", addrID: 5 },
		]);
		assert.deepEqual(await db.getAddressesIds(["first", "second"]), {
			first: 3,
			second: 5,
		});
		assert.equal(stream.close.mock.calls.length, 1);
		assert.equal(connection.release.mock.calls.length, 1);
	});
});

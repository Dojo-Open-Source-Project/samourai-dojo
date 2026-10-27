import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { Pool } from "mariadb";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import db from "../../../lib/db/mysql-db-wrapper.js";
import Logger from "../../../lib/logger.js";
import util from "../../../lib/util.js";

beforeEach(() => {
	db.dbConfig = { namedPlaceholders: true };
	vi.spyOn(Logger, "error").mockImplementation(() => {});
	vi.spyOn(util, "delay").mockResolvedValue(undefined);
});

afterEach(() => {
	db.pool = null;
	db.dbConfig = null;
	vi.restoreAllMocks();
});

describe("Prepared insert batches", () => {
	it("supports a batch at the prepared protocol parameter limit", async () => {
		const execute = vi
			.fn()
			.mockResolvedValue([{ insertId: 1, affectedRows: 65535 }, []]);
		db.pool = { execute } as unknown as Pool;
		await db.addAddresses(Array.from({ length: 65535 }, () => "address"));
		assert.equal(execute.mock.calls.length, 1);
		assert.equal(execute.mock.calls[0][1].length, 65535);
		assert.equal(execute.mock.calls[0][0].sql.match(/\?/g).length, 65535);
	});

	it("keeps oversized address collections in one text statement", async () => {
		const result = { insertId: 1, affectedRows: 65536, warningStatus: 0 };
		const query = vi.fn().mockResolvedValue([result, []]);
		const execute = vi.fn();
		db.pool = { query, execute } as unknown as Pool;
		assert.equal(
			await db.addAddresses(Array.from({ length: 65536 }, () => "address")),
			result,
		);
		assert.equal(execute.mock.calls.length, 0);
		assert.equal(query.mock.calls.length, 1);
		assert.match(query.mock.calls[0][0], /VALUES \('address'\), \('address'\)/);
	});

	it("counts all columns when deciding whether an output batch fits the parameter limit", async () => {
		const query = vi
			.fn()
			.mockResolvedValue([{ insertId: 1, affectedRows: 13108 }, []]);
		const execute = vi.fn();
		db.pool = { query, execute } as unknown as Pool;
		await db.addOutputs(
			Array.from({ length: 13108 }, () => ({
				txnID: 1,
				addrID: 2,
				outIndex: 0,
				outAmount: 3,
				outScript: "script",
			})),
		);
		assert.equal(execute.mock.calls.length, 0);
		assert.equal(query.mock.calls.length, 1);
	});

	it("keeps the empty-input return values without accessing the database", async () => {
		db.pool = null;
		assert.deepEqual(await db.addAddresses([]), []);
		assert.equal(await db.addTransactions([]), undefined);
		assert.equal(await db.addOutputs([]), undefined);
		assert.equal(await db.addInputs([]), undefined);
		assert.equal(await db.addAddressesToHDAccount("xpub", []), undefined);
	});

	it.each(["ER_LOCK_DEADLOCK", "ER_LOCK_TIMEOUT", "ER_LOCK_WAIT_TIMEOUT"])(
		"retries the entire prepared batch after %s",
		async (code) => {
			const result = { insertId: 1, affectedRows: 2 };
			const execute = vi
				.fn()
				.mockRejectedValueOnce(Object.assign(new Error("locked"), { code }))
				.mockResolvedValueOnce([result, []]);
			db.pool = { execute } as unknown as Pool;
			assert.equal(await db.addAddresses(["first", "second"]), result);
			assert.equal(execute.mock.calls.length, 2);
			assert.deepEqual(execute.mock.calls[0], execute.mock.calls[1]);
		},
	);

	it("bounds retries and preserves the original batch error", async () => {
		const error = Object.assign(new Error("locked"), {
			code: "ER_LOCK_DEADLOCK",
		});
		const execute = vi.fn().mockRejectedValue(error);
		db.pool = { execute } as unknown as Pool;
		await assert.rejects(
			db.addAddresses(["first", "second"]),
			(e) => e === error,
		);
		assert.equal(execute.mock.calls.length, 6);
	});

	it("retains timestamp defaults without mutating transaction input objects", async () => {
		vi.spyOn(util, "unix").mockReturnValue(1234);
		const execute = vi
			.fn()
			.mockResolvedValue([{ insertId: 1, affectedRows: 2 }, []]);
		db.pool = { execute } as unknown as Pool;
		const transactions = [
			{ txid: "zero", created: 0, version: 1, locktime: 0 },
			{ txid: "omitted", version: 2, locktime: 3 },
		];
		await db.addTransactions(transactions);
		assert.deepEqual(execute.mock.calls[0][1], [
			"zero",
			1234,
			1,
			0,
			"omitted",
			1234,
			2,
			3,
		]);
		assert.equal(transactions[0].created, 0);
		assert.equal(transactions[1].created, undefined);
	});
	it("binds HD links after inserting and resolving their addresses", async () => {
		const result = { insertId: 8, affectedRows: 2, warningStatus: 0 };
		const execute = vi
			.fn()
			.mockResolvedValueOnce([[{ hdID: 4 }], []])
			.mockResolvedValueOnce([{ insertId: 2, affectedRows: 2 }, []])
			.mockResolvedValueOnce([result, []]);
		const stream = Object.assign(
			Readable.from([
				{ addrAddress: "first", addrID: 2 },
				{ addrAddress: "second", addrID: 3 },
			]),
			{ close: vi.fn() },
		);
		db.pool = {
			execute,
			getConnection: async () => ({
				queryStream: () => stream,
				release: async () => {},
			}),
		} as unknown as Pool;
		assert.equal(
			await db.addAddressesToHDAccount("xpub", [
				{ address: "first", chain: 0, index: 1 },
				{ address: "second", chain: 1, index: 2 },
			]),
			result,
		);
		assert.equal(execute.mock.calls.length, 3);
		assert.deepEqual(execute.mock.calls[2][1], [4, 2, 0, 1, 4, 3, 1, 2]);
	});
	it("binds input tuples while retaining their duplicate update clause", async () => {
		const execute = vi
			.fn()
			.mockResolvedValue([{ insertId: 1, affectedRows: 2 }, []]);
		db.pool = { execute } as unknown as Pool;
		await db.addInputs([
			{ txnID: 1, outID: 2, inIndex: 0, inSequence: 0xffffffff },
			{ txnID: 1, outID: 3, inIndex: 1, inSequence: 5 },
		]);
		assert.equal(execute.mock.calls.length, 1);
		assert.match(
			execute.mock.calls[0][0].sql,
			/ON DUPLICATE KEY UPDATE outID = VALUES\(outID\)/,
		);
		assert.deepEqual(
			execute.mock.calls[0][1],
			[1, 2, 0, 0xffffffff, 1, 3, 1, 5],
		);
	});
	it("binds output amounts and scripts in one insert", async () => {
		const execute = vi
			.fn()
			.mockResolvedValue([{ insertId: 1, affectedRows: 2 }, []]);
		db.pool = { execute } as unknown as Pool;
		await db.addOutputs([
			{
				txnID: 1,
				addrID: 2,
				outIndex: 0,
				outAmount: 5000000000,
				outScript: "'\\?",
			},
			{ txnID: 1, addrID: 3, outIndex: 1, outAmount: 10, outScript: "second" },
		]);
		assert.equal(execute.mock.calls.length, 1);
		assert.deepEqual(execute.mock.calls[0][1], [
			1,
			2,
			0,
			5000000000,
			"'\\?",
			1,
			3,
			1,
			10,
			"second",
		]);
	});
	it("binds transaction tuples in one statement and keeps the upsert clause", async () => {
		const result = { insertId: 7, affectedRows: 2, warningStatus: 0 };
		const execute = vi.fn().mockResolvedValue([result, []]);
		db.pool = { execute } as unknown as Pool;
		assert.equal(
			await db.addTransactions([
				{ txid: "first", created: 100, version: 1, locktime: 0 },
				{ txid: "second", created: 200, version: 2, locktime: 10 },
			]),
			result,
		);
		assert.equal(execute.mock.calls.length, 1);
		assert.match(
			execute.mock.calls[0][0].sql,
			/VALUES \(\?,\?,\?,\?\),\(\?,\?,\?,\?\)\s+ON DUPLICATE KEY UPDATE txnVersion = VALUES\(txnVersion\)/,
		);
		assert.deepEqual(execute.mock.calls[0][1], [
			"first",
			100,
			1,
			0,
			"second",
			200,
			2,
			10,
		]);
	});
	it("binds an address collection in one prepared statement", async () => {
		const result = { insertId: 2, affectedRows: 2, warningStatus: 0 };
		const execute = vi.fn().mockResolvedValue([result, []]);
		db.pool = { execute } as unknown as Pool;
		assert.equal(await db.addAddresses(["first", "quote'\\?value"]), result);
		assert.deepEqual(execute.mock.calls, [
			[
				{
					sql: "INSERT IGNORE INTO `addresses` (addrAddress) VALUES (?),(?)",
					namedPlaceholders: false,
				},
				["first", "quote'\\?value"],
			],
		]);
	});
});

import assert from "node:assert/strict";
import mariadb, { type Pool } from "mariadb";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import db from "../../../lib/db/mysql-db-wrapper.js";
import Logger from "../../../lib/logger.js";
import util from "../../../lib/util.js";

function deferred() {
	let resolve: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve: () => resolve() };
}

describe("Database wrapper", () => {
	const pool = {
		query: vi.fn(),
		execute: vi.fn(),
		end: vi.fn(),
	};

	beforeEach(() => {
		vi.spyOn(Logger, "info").mockImplementation(() => {});
		vi.spyOn(Logger, "error").mockImplementation(() => {});
		vi.spyOn(mariadb, "createPool").mockReturnValue(pool as unknown as Pool);
		vi.spyOn(util, "delay").mockResolvedValue(undefined);
		pool.query.mockResolvedValue([[], []]);
		pool.execute.mockResolvedValue([[], []]);
		pool.end.mockResolvedValue(undefined);
		db.connect({ host: "localhost", connectionLimit: 3 });
	});

	afterEach(async () => {
		if (db.timerReconnect) clearTimeout(db.timerReconnect);
		db.timerReconnect = null;
		db.lockReconnect = false;
		await db.disconnect();
		vi.restoreAllMocks();
		vi.resetAllMocks();
	});

	it("preserves numeric results, row metadata handling, and pool defaults", () => {
		assert.deepEqual(db.dbConfig, {
			decimalAsNumber: true,
			bigIntAsNumber: true,
			insertIdAsNumber: true,
			metaAsArray: true,
			collation: "UTF8MB4_UNICODE_CI",
			connectTimeout: 10000,
			minimumIdle: 0,
			namedPlaceholders: true,
			host: "localhost",
			connectionLimit: 3,
		});
		assert.equal(vi.mocked(mariadb.createPool).mock.calls[0][0], db.dbConfig);
	});

	it("keeps socket paths and explicit connection settings", async () => {
		await db.disconnect();
		db.connect({ host: "/tmp/mysql.sock", connectTimeout: 2500 });
		assert.equal(db.dbConfig.socketPath, "/tmp/mysql.sock");
		assert.equal(db.dbConfig.connectTimeout, 2500);
	});

	it("keeps array, bulk insert, object, and scalar SQL formatting", async () => {
		await db.getAddresses(["first", "quote'\\value"]);
		assert.equal(
			pool.query.mock.lastCall[0],
			"SELECT * FROM `addresses` WHERE `addrAddress` IN ('first', 'quote\\'\\\\value')",
		);
		await db.addAddresses(["first", "second"]);
		assert.equal(
			pool.query.mock.lastCall[0],
			"INSERT IGNORE INTO `addresses` (addrAddress) VALUES ('first'), ('second')",
		);
		pool.query.mockResolvedValue([{ insertId: 7 }, []]);
		assert.equal(
			await db.addBlock({
				blockHash: "hash",
				blockHeight: 1,
				blockParent: null,
				blockTime: 2,
			}),
			7,
		);
		assert.equal(
			pool.query.mock.lastCall[0],
			"INSERT IGNORE INTO `blocks` SET `blockHash` = 'hash', `blockHeight` = 1, `blockParent` = NULL, `blockTime` = 2",
		);
		await db.getLastBlocks(5);
		assert.equal(
			pool.query.mock.lastCall[0],
			"SELECT * FROM `blocks` ORDER BY `blockHeight` DESC LIMIT 5",
		);
	});

	it("returns rows and write results without metadata for both query protocols", async () => {
		const rows = [{ addrID: 7 }];
		pool.execute.mockResolvedValue([rows, [{ name: "addrID" }]]);
		assert.equal(await db.getAddressId("address"), 7);
		assert.deepEqual(pool.execute.mock.lastCall, [
			{
				sql: "SELECT `addrID` FROM `addresses` WHERE `addrAddress` = ?",
				namedPlaceholders: false,
			},
			["address"],
		]);
		pool.query.mockResolvedValue([rows, [{ name: "addrID" }]]);
		assert.equal(await db.getAddresses(["address"]), rows);
		const write = { insertId: 4, affectedRows: 2 };
		pool.query.mockResolvedValue([write, []]);
		assert.equal(await db.addAddresses(["one", "two"]), write);
	});

	it.each(["ER_LOCK_DEADLOCK", "ER_LOCK_TIMEOUT", "ER_LOCK_WAIT_TIMEOUT"])(
		"retries %s with the same prepared parameters",
		async (code) => {
			pool.execute.mockRejectedValueOnce(
				Object.assign(new Error("locked"), { code }),
			);
			pool.execute.mockResolvedValueOnce([[{ addrID: 8 }], []]);
			assert.equal(await db.getAddressId("address"), 8);
			assert.equal(pool.execute.mock.calls.length, 2);
			assert.deepEqual(pool.execute.mock.calls[0], pool.execute.mock.calls[1]);
		},
	);

	it("bounds lock retries and propagates the original database error", async () => {
		const error = Object.assign(new Error("locked"), {
			code: "ER_LOCK_DEADLOCK",
		});
		pool.query.mockRejectedValue(error);
		await assert.rejects(
			db._query("SELECT ?", [1], false, 2),
			(e) => e === error,
		);
		assert.equal(pool.query.mock.calls.length, 3);
	});

	it("propagates other database errors without retrying", async () => {
		const error = Object.assign(new Error("bad SQL"), {
			code: "ER_PARSE_ERROR",
		});
		pool.query.mockRejectedValueOnce(error);
		await assert.rejects(db._query("invalid"), (e) => e === error);
		assert.equal(pool.query.mock.calls.length, 1);
	});

	it("waits for the pool to close before completing disconnect", async () => {
		const closing = deferred();
		pool.end.mockReturnValueOnce(closing.promise);
		let done = false;
		const disconnected = db.disconnect().then(() => {
			done = true;
		});
		await Promise.resolve();
		assert.equal(done, false);
		assert.ok(db.pool);
		closing.resolve();
		await disconnected;
		assert.equal(db.pool, null);
		await db.disconnect();
		assert.equal(pool.end.mock.calls.length, 1);
	});

	it("logs shutdown failures and clears the pool", async () => {
		const error = new Error("shutdown failed");
		pool.end.mockRejectedValueOnce(error);
		await db.disconnect();
		assert.equal(db.pool, null);
		assert.equal(vi.mocked(Logger.error).mock.calls[0][0], error);
	});

	it("closes the old pool before reconnecting and prevents overlapping reconnects", async () => {
		const closing = deferred();
		pool.end.mockReturnValueOnce(closing.promise);
		db.connect({ host: "new-host" });
		db.handleReconnect();
		assert.equal(db.lockReconnect, true);
		assert.equal(pool.end.mock.calls.length, 1);
		assert.equal(vi.mocked(mariadb.createPool).mock.calls.length, 1);
		closing.resolve();
		await vi.waitFor(() => assert.equal(db.lockReconnect, false));
		assert.equal(vi.mocked(mariadb.createPool).mock.calls.length, 2);
		assert.equal(db.dbConfig.host, "new-host");
	});

	it("schedules another reconnect after a pool shutdown failure", async () => {
		pool.end.mockRejectedValueOnce(new Error("shutdown failed"));
		db.handleReconnect();
		await vi.waitFor(() => assert.ok(db.timerReconnect));
		assert.equal(db.lockReconnect, false);
		assert.equal(vi.mocked(mariadb.createPool).mock.calls.length, 1);
	});
});

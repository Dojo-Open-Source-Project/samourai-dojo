import assert from "node:assert/strict";
import type { Pool } from "mariadb";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import db from "../../../lib/db/mysql-db-wrapper.js";
import Logger from "../../../lib/logger.js";
import util from "../../../lib/util.js";

function connection() {
	return {
		query: vi.fn(async (_sql: string) => [[], []]),
		execute: vi.fn(
			async (_sql: unknown, _values: unknown[]): Promise<unknown[]> => [[], []],
		),
		commit: vi.fn(async () => {}),
		rollback: vi.fn(async () => {}),
		release: vi.fn(async () => {}),
	};
}

const requests = (count: number) =>
	Array.from({ length: count }, (_, vout) => ({ txid: "a".repeat(64), vout }));

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

describe("Bounded outpoint lookups", () => {
	it("bounds UNION branches and parameters without falling back to text queries", async () => {
		const conn = connection();
		db.pool = { getConnection: async () => conn } as unknown as Pool;
		assert.deepEqual(await db.getOutputIds(requests(33000)), []);
		assert.equal(conn.execute.mock.calls.length, 33);
		for (const [query, values] of conn.execute.mock.calls) {
			assert.equal(values.length, 2000);
			assert.equal(
				(query as { sql: string }).sql.match(/SELECT/g).length,
				1001,
			);
		}
		assert.deepEqual(conn.query.mock.calls.map((args) => args[0]), [
			"SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
			"START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
		]);
		assert.equal(conn.commit.mock.calls.length, 1);
		assert.equal(conn.release.mock.calls.length, 1);
	});

	it("also limits batches by the configured packet budget", async () => {
		const conn = connection();
		db.dbConfig.maxAllowedPacket = 4096;
		db.pool = { getConnection: async () => conn } as unknown as Pool;
		await db.getOutputIds(requests(100));
		assert.ok(conn.execute.mock.calls.length > 1);
		for (const [query, values] of conn.execute.mock.calls) {
			assert.ok(
				Buffer.byteLength((query as { sql: string }).sql) +
					(values.length / 2) * 96 <
					4096,
			);
		}
	});

	it("deduplicates output identities across batches", async () => {
		const conn = connection();
		const row = { outID: 1, txnTxid: "a".repeat(64), outIndex: 0 };
		conn.execute.mockResolvedValue([[row], []]);
		db.pool = { getConnection: async () => conn } as unknown as Pool;
		assert.deepEqual(await db.getOutputIds(requests(1001)), [row]);
	});

	it("retains separate spending inputs with identical public rows and hides internal IDs", async () => {
		const conn = connection();
		const row = {
			outID: 1,
			txnTxid: "a".repeat(64),
			outIndex: 0,
			outAmount: 10,
			addrAddress: "address",
			spendingTxnID: 2,
		};
		conn.execute.mockImplementation(async () => [
			[
				{ ...row, _outpointInputId: 7 },
				{ ...row, _outpointInputId: 8 },
			],
			[],
		]);
		db.pool = { getConnection: async () => conn } as unknown as Pool;
		assert.deepEqual(
			await db.getOutputSpends(
				requests(1001).map(({ txid, vout }) => ({ txid, index: vout })),
			),
			[row, row],
		);
	});

	it.each(["ER_LOCK_DEADLOCK", "ER_LOCK_TIMEOUT", "ER_LOCK_WAIT_TIMEOUT"])(
		"discards partial results and retries the complete snapshot after %s",
		async (code) => {
			const first = connection();
			const second = connection();
			const error = Object.assign(new Error("locked"), { code });
			first.execute
				.mockResolvedValueOnce([[{ outID: 1 }], []])
				.mockRejectedValueOnce(error);
			second.execute.mockResolvedValueOnce([[{ outID: 2 }], []]);
			const getConnection = vi
				.fn()
				.mockResolvedValueOnce(first)
				.mockResolvedValueOnce(second);
			db.pool = { getConnection } as unknown as Pool;
			assert.deepEqual(await db.getOutputIds(requests(1001)), [{ outID: 2 }]);
			assert.equal(first.rollback.mock.calls.length, 1);
			assert.equal(first.release.mock.calls.length, 1);
			assert.equal(first.commit.mock.calls.length, 0);
			assert.equal(second.execute.mock.calls.length, 2);
			assert.equal(second.commit.mock.calls.length, 1);
			assert.equal(second.release.mock.calls.length, 1);
		},
	);

	it("bounds retries and preserves the original error if rollback fails", async () => {
		const conn = connection();
		const error = Object.assign(new Error("locked"), {
			code: "ER_LOCK_DEADLOCK",
		});
		conn.execute.mockRejectedValue(error);
		conn.rollback.mockRejectedValue(new Error("rollback failed"));
		db.pool = { getConnection: async () => conn } as unknown as Pool;
		await assert.rejects(
			db.getOutputIds(requests(1001)),
			(caught) => caught === error,
		);
		assert.equal(conn.execute.mock.calls.length, 6);
		assert.equal(conn.rollback.mock.calls.length, 6);
		assert.equal(conn.release.mock.calls.length, 6);
	});

	it("propagates a non-lock error without returning partial rows", async () => {
		const conn = connection();
		const error = new Error("connection lost");
		conn.execute
			.mockResolvedValueOnce([[{ outID: 1 }], []])
			.mockRejectedValueOnce(error);
		db.pool = { getConnection: async () => conn } as unknown as Pool;
		await assert.rejects(
			db.getOutputIds(requests(1001)),
			(caught) => caught === error,
		);
		assert.equal(conn.rollback.mock.calls.length, 1);
		assert.equal(conn.commit.mock.calls.length, 0);
		assert.equal(conn.release.mock.calls.length, 1);
	});
});

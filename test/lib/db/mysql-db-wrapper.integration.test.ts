import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mariadb, { type Connection } from "mariadb";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import db from "../../../lib/db/mysql-db-wrapper.js";

// Opt in with DOJO_TEST_DB_PORT pointing to a disposable local MariaDB server
// accepting root without a password. Each run creates and drops its own database.
const port = Number(process.env.DOJO_TEST_DB_PORT);
const database = `dojo_driver_test_${randomUUID().replaceAll("-", "")}`;
const connectionConfig = {
	host: "127.0.0.1",
	port,
	user: "root",
	password: "",
};

describe.skipIf(!port)("Database driver integration", () => {
	let admin: Connection;

	beforeAll(async () => {
		admin = await mariadb.createConnection({
			...connectionConfig,
			multipleStatements: true,
		});
		await admin.query(`CREATE DATABASE ${admin.escapeId(database)}`);
		await admin.query(`USE ${admin.escapeId(database)}`);
		for (const script of ["1_db.sql", "2_update.sql"]) {
			await admin.query(
				await readFile(
					new URL(`../../../db-scripts/${script}`, import.meta.url),
					"utf8",
				),
			);
		}
		db.connect({ ...connectionConfig, database, connectionLimit: 2 });
	});

	afterAll(async () => {
		await db.disconnect();
		if (admin) {
			try {
				await admin.query(
					`DROP DATABASE IF EXISTS ${admin.escapeId(database)}`,
				);
			} finally {
				await admin.end();
			}
		}
	});

	it.each([false, true])(
		"keeps numeric results and plain row arrays with usePrepare=%s",
		async (usePrepare) => {
			const rows = await db._query(
				"SELECT CAST(? AS UNSIGNED) AS amount, CAST(? AS DECIMAL(20,8)) AS balance, NULL AS missing",
				[2100000000000000, "12.34567890"],
				usePrepare,
			);
			assert.deepEqual(rows, [
				{ amount: 2100000000000000, balance: 12.3456789, missing: null },
			]);
			assert.doesNotThrow(() => JSON.stringify(rows));
		},
	);

	it("supports named prepared parameters alongside positional arrays", async () => {
		const named = await db._query(
			"SELECT :value AS amount",
			{ value: 42 },
			true,
		);
		assert.equal(named[0].amount, 42);
		const positional = await db._query("SELECT ? AS amount", [43], true);
		assert.equal(positional[0].amount, 43);
	});

	it("supports bulk lists, object inserts, escaping, and prepared lookups", async () => {
		const addresses = ["first", "second", "quote'\\value?; --"];
		const result = await db.addAddresses(addresses);
		assert.ok("insertId" in result);
		assert.ok("affectedRows" in result);
		assert.equal(typeof result.insertId, "number");
		assert.equal(result.affectedRows, 3);
		const rows = await db.getAddresses(addresses);
		assert.deepEqual(
			rows.map((row) => row.addrAddress).sort(),
			[...addresses].sort(),
		);
		assert.equal(
			await db.getAddressId(addresses[2]),
			rows.find((row) => row.addrAddress === addresses[2]).addrID,
		);
		const id = await db.ensureAddressId("object-insert");
		assert.equal(typeof id, "number");
		assert.equal(await db.ensureAddressId("object-insert"), id);
	});

	it("keeps numeric balances, bulk outputs and inputs, and formatted subqueries", async () => {
		const addrID = await db.ensureAddressId("balance-address");
		const txnID = await db.ensureTransactionId("a".repeat(64));
		await db.addOutputs([
			{
				txnID,
				addrID,
				outIndex: 0,
				outAmount: 5000000000,
				outScript: "76a914",
			},
			{ txnID, addrID, outIndex: 1, outAmount: 123, outScript: "00" },
		]);
		assert.equal(await db.getAddressBalance("balance-address"), 5000000123);
		assert.equal(
			await db.getAddrAndXpubsNbTransactions(
				["balance-address"],
				["unused-xpub"],
			),
			1,
		);
		const transactions = await db.getTxsByAddrAndXpubs(
			["balance-address"],
			["unused-xpub"],
			0,
			5,
		);
		assert.equal(transactions.length, 1);
		const outputs = await db.getOutputIds([{ txid: "a".repeat(64), vout: 0 }]);
		assert.equal(outputs.length, 1);
		const spender = await db.ensureTransactionId("b".repeat(64));
		await db.addInputs([
			{
				txnID: spender,
				outID: outputs[0].outID,
				inIndex: 0,
				inSequence: 0xffffffff,
			},
		]);
		assert.equal(await db.getAddressBalance("balance-address"), 123);
		assert.equal(
			(await db.getOutputSpends([{ txid: "a".repeat(64), index: 0 }]))[0]
				.spendingTxnID,
			spender,
		);
	});

	it("keeps inserted IDs, nullable fields, and scalar LIMIT parameters", async () => {
		const hash = "c".repeat(64);
		const block = {
			blockHash: hash,
			blockParent: null as number | null,
			blockHeight: 10,
			blockTime: 1234567,
		};
		const id = await db.addBlock(block);
		assert.equal(typeof id, "number");
		assert.equal(await db.addBlock(block), id);
		assert.equal((await db.getBlockByHash(hash)).blockParent, null);
		assert.equal((await db.getLastBlocks(1))[0].blockID, id);
		const scheduled = await db.addScheduledTransaction({
			txid: "d".repeat(64),
			rawTx: "00",
			delay: 0,
			trigger: 100,
		});
		assert.equal(typeof scheduled, "number");
		const rows = await db.getScheduledTransactions();
		assert.equal(rows[0].schParentID, null);
		assert.equal(rows[0].schParentTxid, null);
	});

	it("preserves dates, booleans, Unicode strings, and write counts", async () => {
		const expiresAt = new Date("2040-01-02T03:04:05Z");
		const result = await db.createApiKey(
			"Příliš 🥷 ' \\",
			"test-api-key",
			expiresAt,
		);
		assert.equal(typeof result.insertId, "number");
		let keys = await db.getApiKeys();
		assert.equal(keys[0].label, "Příliš 🥷 ' \\");
		assert.equal(keys[0].active, true);
		assert.equal(keys[0].expiresAt.getTime(), expiresAt.getTime());
		assert.equal((await db.getActiveApiKeys()).length, 1);
		const updated = await db.updateApiKey(
			result.insertId,
			"updated",
			false,
			expiresAt,
		);
		assert.equal(updated.affectedRows, 1);
		keys = await db.getApiKeys();
		assert.equal(keys[0].active, false);
		assert.equal((await db.getActiveApiKeys()).length, 0);
	});

	it("can query after reconnecting and waits for disconnect to finish", async () => {
		const previous = db.pool;
		db.connect({ ...connectionConfig, database, connectionLimit: 2 });
		await vi.waitFor(() => assert.equal(db.lockReconnect, false));
		assert.equal(previous.closed, true);
		assert.notEqual(db.pool, previous);
		assert.equal((await db.getLastBlocks(1)).length, 1);
		const current = db.pool;
		await db.disconnect();
		assert.equal(current.closed, true);
		assert.equal(db.pool, null);
	});
});

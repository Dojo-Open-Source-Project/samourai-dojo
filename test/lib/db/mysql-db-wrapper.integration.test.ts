import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mariadb, { type Connection } from "mariadb";
import { afterAll, beforeAll, describe, it, vi } from "vitest";
import hdaHelper from "../../../lib/bitcoin/hd-accounts-helper.js";
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

async function responseTransactions(tag: "single" | "page") {
	const parentTxid = (tag === "single" ? "1" : "4").repeat(64);
	const txid = (tag === "single" ? "2" : "5").repeat(64);
	const blockHash = (tag === "single" ? "3" : "6").repeat(64);
	const xpub = `response-${tag}-xpub`;
	const incoming = `${tag}-incoming`;
	const outgoing = `${tag}-outgoing`;
	const loose = `${tag}-loose`;
	await db.ensureHDAccountId(xpub, hdaHelper.BIP44);
	await db.addAddressesToHDAccount(xpub, [
		{ address: incoming, chain: 0, index: 1 },
		{ address: outgoing, chain: 1, index: 2 },
	]);
	const incomingID = await db.getAddressId(incoming);
	const outgoingID = await db.getAddressId(outgoing);
	const looseID = await db.ensureAddressId(loose);
	await db.addTransactions([
		{ txid: parentTxid, created: 1000, version: 1, locktime: 0 },
		{ txid, created: 3000, version: 2, locktime: 17 },
	]);
	const parentID = await db.getTransactionId(parentTxid);
	const txnID = await db.getTransactionId(txid);
	await db.addOutputs([
		{
			txnID: parentID,
			addrID: incomingID,
			outIndex: 0,
			outAmount: 100,
			outScript: "parent-script",
		},
		{
			txnID,
			addrID: looseID,
			outIndex: 1,
			outAmount: 60,
			outScript: "loose-script",
		},
		{
			txnID,
			addrID: outgoingID,
			outIndex: 0,
			outAmount: 35,
			outScript: "owned-script",
		},
	]);
	const outputs = await db.getOutputIds([{ txid: parentTxid, vout: 0 }]);
	await db.addInputs([
		{ txnID, outID: outputs[0].outID, inIndex: 0, inSequence: 0xfffffffe },
	]);
	const blockID = await db.addBlock({
		blockHash,
		blockParent: null,
		blockHeight: 20,
		blockTime: 2000,
	});
	await db.confirmTransactions([txid], blockID);
	return { parentTxid, txid, xpub, incoming, outgoing, loose };
}

async function withSmallPackets(run: () => Promise<void>, foundRows = true) {
	db.connect({
		...connectionConfig,
		database,
		connectionLimit: 1,
		maxAllowedPacket: 4096,
		foundRows,
	});
	await vi.waitFor(() => assert.equal(db.lockReconnect, false));
	try {
		await run();
	} finally {
		db.connect({ ...connectionConfig, database, connectionLimit: 2 });
		await vi.waitFor(() => assert.equal(db.lockReconnect, false));
	}
}

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
			const rows = await db._query<
				{ amount: number; balance: number; missing: null }[]
			>(
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
		const named = await db._query<{ amount: number }[]>(
			"SELECT :value AS amount",
			{ value: 42 },
			true,
		);
		assert.equal(named[0].amount, 42);
		const positional = await db._query<{ amount: number }[]>(
			"SELECT ? AS amount",
			[43],
			true,
		);
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

	it("maps address and transaction IDs without including missing or duplicate lookups", async () => {
		const first = await db.ensureAddressId("map-first");
		const quoted = await db.ensureAddressId("map-'\\second");
		assert.deepEqual(
			await db.getAddressesIds([
				"map-first",
				"missing",
				"map-'\\second",
				"map-first",
			]),
			{
				"map-first": first,
				"map-'\\second": quoted,
			},
		);
		const txid = "e".repeat(64);
		const txnID = await db.ensureTransactionId(txid);
		assert.deepEqual(await db.getTransactionsIds([txid, "missing", txid]), {
			[txid]: txnID,
		});
		assert.deepEqual(await db.getAddressesIds([]), {});
		assert.deepEqual(await db.getTransactionsIds([]), {});
	});

	it("groups shared HD addresses, retains loose addresses, and excludes banned addresses", async () => {
		const hdID = await db.ensureHDAccountId("stream-xpub-a", hdaHelper.BIP44);
		const secondID = await db.ensureHDAccountId(
			"stream-xpub-b",
			hdaHelper.BIP44,
		);
		await db.addAddressesToHDAccount("stream-xpub-a", [
			{ address: "stream-owned", chain: 0, index: 3 },
			{ address: "stream-banned", chain: 1, index: 4 },
		]);
		await db.addAddressesToHDAccount("stream-xpub-b", [
			{ address: "stream-owned", chain: 1, index: 8 },
		]);
		const ownedID = await db.getAddressId("stream-owned");
		const looseID = await db.ensureAddressId("stream-loose");
		await db._query("INSERT INTO `banned_addresses` (addrAddress) VALUES (?)", [
			"stream-banned",
		]);
		assert.deepEqual(
			await db.getHDAccountsByAddresses([
				"stream-owned",
				"stream-loose",
				"stream-banned",
				"missing",
			]),
			{
				hd: {
					"stream-xpub-a": {
						hdID,
						hdType: hdaHelper.BIP44,
						addresses: [
							{
								addrID: ownedID,
								addrAddress: "stream-owned",
								hdAddrChain: 0,
								hdAddrIndex: 3,
							},
						],
					},
					"stream-xpub-b": {
						hdID: secondID,
						hdType: hdaHelper.BIP44,
						addresses: [
							{
								addrID: ownedID,
								addrAddress: "stream-owned",
								hdAddrChain: 1,
								hdAddrIndex: 8,
							},
						],
					},
				},
				loose: [{ addrID: looseID, addrAddress: "stream-loose" }],
			},
		);
		assert.deepEqual(await db.getHDAccountsByAddresses([]), {
			hd: {},
			loose: [],
		});
		assert.deepEqual(
			await db.getXpubByAddresses(["stream-banned", "stream-loose", "missing"]),
			{ "stream-banned": "stream-xpub-a" },
		);
		assert.deepEqual(await db.getXpubByAddresses([]), {});
	});

	it("preserves transaction input/output order, scripts, HD paths, confirmations, and missing transactions", async () => {
		const { parentTxid, txid, xpub, incoming, outgoing, loose } =
			await responseTransactions("single");
		assert.deepEqual(await db.getTransaction(txid), {
			hash: txid,
			time: 2000,
			version: 2,
			locktime: 17,
			block_height: 20,
			inputs: [
				{
					vin: 0,
					sequence: 0xfffffffe,
					prev_out: {
						txid: parentTxid,
						vout: 0,
						value: 100,
						addr: incoming,
						script: "parent-script",
						xpub: { m: xpub, path: "M/0/1" },
					},
				},
			],
			out: [
				{
					n: 0,
					value: 35,
					addr: outgoing,
					script: "owned-script",
					xpub: { m: xpub, path: "M/1/2" },
				},
				{ n: 1, value: 60, addr: loose, script: "loose-script" },
			],
		});
		assert.deepEqual(await db.getTransaction("missing"), {
			hash: "missing",
			time: Infinity,
			version: 0,
			locktime: 0,
			inputs: [],
			out: [],
		});
	});

	it("preserves transaction paging, deduplication, wallet totals, and unconfirmed rows", async () => {
		const { parentTxid, txid, xpub, incoming, outgoing, loose } =
			await responseTransactions("page");
		const rows = await db.getTxsByAddrAndXpubs([loose], [xpub], 0, 10);
		assert.deepEqual(rows, [
			{
				hash: txid,
				time: 2000,
				version: 2,
				locktime: 17,
				block_height: 20,
				result: -5,
				inputs: [
					{
						vin: 0,
						sequence: 0xfffffffe,
						prev_out: {
							txid: parentTxid,
							vout: 0,
							value: 100,
							addr: incoming,
							xpub: { m: xpub, path: "M/0/1" },
						},
					},
				],
				out: [
					{ n: 0, value: 35, addr: outgoing, xpub: { m: xpub, path: "M/1/2" } },
					{ n: 1, value: 60, addr: loose },
				],
			},
			{
				hash: parentTxid,
				time: 1000,
				version: 1,
				locktime: 0,
				result: 100,
				inputs: [],
				out: [
					{
						n: 0,
						value: 100,
						addr: incoming,
						xpub: { m: xpub, path: "M/0/1" },
					},
				],
			},
		]);
		assert.deepEqual(await db.getTxsByAddrAndXpubs([loose], [xpub], 1, 1), [
			rows[1],
		]);
		assert.deepEqual(await db.getTxsByAddrAndXpubs([loose], [xpub], 2, 1), []);
		assert.deepEqual(await db.getTxsByAddrAndXpubs([], []), []);
	});

	it("preserves bulk address insert IDs, duplicate warnings, and empty results", async () => {
		await db.ensureAddressId("batch-existing");
		const result = await db.addAddresses([
			"batch-existing",
			"batch-new-a",
			"batch-new-b",
			"batch-new-a",
		]);
		assert.ok(
			"insertId" in result &&
				"affectedRows" in result &&
				"warningStatus" in result,
		);
		assert.equal(result.insertId, await db.getAddressId("batch-new-a"));
		assert.equal(result.affectedRows, 2);
		assert.equal(result.warningStatus, 2);
		const repeated = await db.addAddresses(["batch-existing", "batch-new-a"]);
		assert.ok(
			"insertId" in repeated &&
				"affectedRows" in repeated &&
				"warningStatus" in repeated,
		);
		assert.equal(repeated.insertId, 0);
		assert.equal(repeated.affectedRows, 0);
		assert.equal(repeated.warningStatus, 2);
		assert.deepEqual(await db.addAddresses([]), []);
	});

	it("preserves transaction batch upserts, aggregate IDs, and all-or-nothing failures", async () => {
		await db.addTransactions([
			{ txid: "batch-first-tx", version: 1, locktime: 11, created: 100 },
			{ txid: "batch-last-tx", version: 1, locktime: 12, created: 200 },
		]);
		const updated = await db.addTransactions([
			{ txid: "batch-first-tx", version: 2, locktime: 99, created: 999 },
			{ txid: "batch-new-tx", version: 3, locktime: 13, created: 300 },
			{ txid: "batch-last-tx", version: 4, locktime: 99, created: 999 },
		]);
		assert.equal(updated.affectedRows, 5);
		assert.equal(updated.insertId, await db.getTransactionId("batch-new-tx"));
		assert.equal(updated.warningStatus, 0);
		const firstID = await db.getTransactionId("batch-first-tx");
		const first = (await db.getTransactionsById([firstID]))[0];
		assert.deepEqual(
			{
				version: first.txnVersion,
				locktime: first.txnLocktime,
				created: first.txnCreated,
			},
			{ version: 2, locktime: 11, created: 100 },
		);
		await assert.rejects(
			db.addTransactions([
				{ txid: "batch-must-rollback", version: 1, locktime: 0, created: 100 },
				{ txid: "batch-invalid", version: null, locktime: 0, created: 100 },
			]),
			{ code: "ER_BAD_NULL_ERROR" },
		);
		assert.equal(await db.getTransactionId("batch-must-rollback"), null);
		assert.equal(await db.getTransactionId("batch-invalid"), null);
		assert.equal(await db.addTransactions([]), undefined);
	});

	it("preserves bulk outputs, input upserts, and foreign-key failure atomicity", async () => {
		const txnID = await db.ensureTransactionId("batch-output-tx");
		const spender = await db.ensureTransactionId("batch-spender-tx");
		const addrID = await db.ensureAddressId("batch-output-address");
		const firstOutput = {
			txnID,
			addrID,
			outIndex: 0,
			outAmount: 5000000000,
			outScript: "quote'\\?script",
		};
		await db.addOutputs([firstOutput]);
		const result = await db.addOutputs([
			{ ...firstOutput, outAmount: 99, outScript: "unchanged" },
			{ txnID, addrID, outIndex: 1, outAmount: 10, outScript: "second" },
		]);
		assert.equal(result.affectedRows, 1);
		assert.equal(result.warningStatus, 1);
		const outputs = await db.getOutputIds([
			{ txid: "batch-output-tx", vout: 0 },
			{ txid: "batch-output-tx", vout: 1 },
		]);
		const firstID = outputs.find((row) => row.outIndex === 0).outID;
		const secondID = outputs.find((row) => row.outIndex === 1).outID;
		assert.equal(result.insertId, secondID);
		assert.equal(
			(await db.getUnspentOutputs(["batch-output-address"])).find(
				(row) => row.outIndex === 0,
			).outScript,
			"quote'\\?script",
		);
		await db.addInputs([
			{ txnID: spender, outID: firstID, inIndex: 0, inSequence: 7 },
		]);
		const updated = await db.addInputs([
			{ txnID: spender, outID: secondID, inIndex: 0, inSequence: 8 },
			{ txnID: spender, outID: firstID, inIndex: 1, inSequence: 9 },
		]);
		const inputs = await db.getTxInputs(spender);
		assert.equal(updated.affectedRows, 3);
		assert.equal(
			updated.insertId,
			inputs.find((row) => row.inIndex === 1).inID,
		);
		assert.deepEqual(
			inputs
				.map((row) => ({
					index: row.inIndex,
					output: row.outID,
					sequence: row.inSequence,
				}))
				.sort((a, b) => a.index - b.index),
			[
				{ index: 0, output: secondID, sequence: 7 },
				{ index: 1, output: firstID, sequence: 9 },
			],
		);
		await assert.rejects(
			db.addInputs([
				{ txnID: spender, outID: firstID, inIndex: 2, inSequence: 1 },
				{ txnID: spender, outID: 0, inIndex: 3, inSequence: 1 },
			]),
			{ code: "ER_NO_REFERENCED_ROW_2" },
		);
		assert.equal((await db.getTxInputs(spender)).length, 2);
		assert.equal(await db.addOutputs([]), undefined);
		assert.equal(await db.addInputs([]), undefined);
	});

	it("preserves duplicate HD links and their warning counts in bulk inserts", async () => {
		const xpub = "batch-hd-xpub";
		await db.ensureHDAccountId(xpub, hdaHelper.BIP44);
		await db.addAddressesToHDAccount(xpub, [
			{ address: "batch-hd-existing", chain: 0, index: 1 },
		]);
		const result = await db.addAddressesToHDAccount(xpub, [
			{ address: "batch-hd-existing", chain: 1, index: 99 },
			{ address: "batch-hd-new", chain: 1, index: 2 },
		]);
		assert.equal(result.affectedRows, 1);
		assert.equal(result.warningStatus, 1);
		assert.equal(typeof result.insertId, "number");
		const grouped = await db.getHDAccountsByAddresses([
			"batch-hd-existing",
			"batch-hd-new",
		]);
		assert.deepEqual(
			grouped.hd[xpub].addresses
				.map((row) => ({
					address: row.addrAddress,
					chain: row.hdAddrChain,
					index: row.hdAddrIndex,
				}))
				.sort((a, b) => a.address.localeCompare(b.address)),
			[
				{ address: "batch-hd-existing", chain: 0, index: 1 },
				{ address: "batch-hd-new", chain: 1, index: 2 },
			],
		);
		assert.equal(await db.addAddressesToHDAccount(xpub, []), undefined);
	});

	it("checks one API key with exact matching and current active/expiry state", async () => {
		const expiresAt = new Date("2040-01-02T03:04:05Z");
		const created = await db.createApiKey(
			"point lookup",
			"CaseSensitive-Key",
			expiresAt,
		);
		assert.equal(await db.isApiKeyActive("CaseSensitive-Key"), true);
		assert.equal(await db.isApiKeyActive("casesensitive-key"), false);
		assert.equal(await db.isApiKeyActive("CaseSensitive-Key "), false);
		assert.equal(await db.isApiKeyActive("missing"), false);
		assert.equal(await db.isApiKeyActive(undefined), false);
		assert.equal(await db.isApiKeyActive(["CaseSensitive-Key"]), false);
		await db.updateApiKey(created.insertId, "disabled", false, expiresAt);
		assert.equal(await db.isApiKeyActive("CaseSensitive-Key"), false);
		await db.updateApiKey(
			created.insertId,
			"expired",
			true,
			new Date("2000-01-01T00:00:00Z"),
		);
		assert.equal(await db.isApiKeyActive("CaseSensitive-Key"), false);
	});

	it("keeps duplicate outpoint requests from multiplying outputs or spends", async () => {
		const txid = "a".repeat(64);
		const expected = await db.getOutputIds([{ txid, vout: 0 }]);
		assert.equal(expected.length, 1);
		assert.deepEqual(
			await db.getOutputIds([
				{ txid, vout: 0 },
				{ txid: txid.toUpperCase(), vout: 0 },
				{ txid: "missing", vout: 0 },
			]),
			expected,
		);
		const spends = await db.getOutputSpends([{ txid, index: 0 }]);
		assert.equal(spends.length, 1);
		assert.deepEqual(
			await db.getOutputSpends([
				{ txid, index: 0 },
				{ txid: txid.toUpperCase(), index: 0 },
				{ txid: "quote'\\?", index: 0 },
			]),
			spends,
		);
		assert.deepEqual(await db.getOutputIds([{ txid }]), []);
	});

	it("reads only transaction IDs for mempool and reorg processing", async () => {
		const confirmed = await db.ensureTransactionId("reader-confirmed");
		await db.ensureTransactionId("reader-unconfirmed");
		const blockID = await db.addBlock({
			blockHash: "ab".repeat(32),
			blockHeight: 50,
			blockTime: 1000,
			blockParent: null,
		});
		await db.confirmTransactions(["reader-confirmed"], blockID);
		const unconfirmed = await db.getUnconfirmedTransactionIds();
		assert.ok(unconfirmed.includes("reader-unconfirmed"));
		assert.ok(!unconfirmed.includes("reader-confirmed"));
		assert.deepEqual(await db.getTransactionIdsConfirmedAfterHeight(49), [
			"reader-confirmed",
		]);
		assert.deepEqual(await db.getTransactionIdsConfirmedAfterHeight(50), []);
		assert.equal(
			(await db.getTransactionsById([confirmed]))[0].blockID,
			blockID,
		);
	});

	it("counts each transaction once across inputs, outputs, and overlapping ownership", async () => {
		assert.equal(await db.getAddressNbTransactions("page-incoming"), 2);
		assert.equal(await db.getHDAccountNbTransactions("response-page-xpub"), 2);
		assert.equal(
			await db.getAddrAndXpubsNbTransactions(
				["page-incoming", "page-loose", "page-incoming"],
				["response-page-xpub"],
			),
			2,
		);
		assert.equal(await db.getAddressNbTransactions("missing"), 0);
		assert.equal(await db.getHDAccountNbTransactions("missing"), 0);
		assert.equal(await db.getAddressNbTransactions(undefined), null);
		assert.deepEqual(await db.getAddrAndXpubsNbTransactions([], []), []);
		const placeholder = await db.ensureTransactionId(undefined);
		const addrID = await db.ensureAddressId("nullable-hash-count");
		await db.addOutputs([
			{
				txnID: placeholder,
				addrID,
				outIndex: 0,
				outAmount: 1,
				outScript: "00",
			},
		]);
		assert.equal(await db.getAddressNbTransactions("nullable-hash-count"), 0);
	});

	it("aggregates ignored-row warnings and first inserted IDs across packet-sized chunks", async () => {
		await withSmallPackets(async () => {
			const addresses = Array.from({ length: 80 }, (_, index) =>
				`chunk-address-${index}`.padEnd(60, "x"),
			);
			await db.addAddresses(addresses.slice(0, 40));
			const result = await db.addAddresses(addresses);
			assert.ok(
				"insertId" in result &&
					"affectedRows" in result &&
					"warningStatus" in result,
			);
			assert.equal(result.affectedRows, 40);
			assert.equal(result.warningStatus, 40);
			assert.equal(result.insertId, await db.getAddressId(addresses[40]));
			const repeated = await db.addAddresses(addresses);
			assert.ok(
				"insertId" in repeated &&
					"affectedRows" in repeated &&
					"warningStatus" in repeated,
			);
			assert.equal(repeated.affectedRows, 0);
			assert.equal(repeated.insertId, 0);
			assert.equal(repeated.warningStatus, 80);
		});
	});

	it("preserves mixed-upsert and unchanged-row insert IDs across chunks", async () => {
		await withSmallPackets(async () => {
			const transactions = Array.from({ length: 60 }, (_, index) => ({
				txid: `chunk-transaction-${index}`,
				version: 2,
				locktime: 0,
				created: 100,
			}));
			await db.addTransactions(
				transactions.slice(0, 40).map((tx) => ({ ...tx, version: 1 })),
			);
			const result = await db.addTransactions(transactions);
			assert.equal(result.affectedRows, 100);
			assert.equal(result.warningStatus, 0);
			assert.equal(
				result.insertId,
				await db.getTransactionId(transactions[40].txid),
			);
			const noop = await db.addTransactions(transactions);
			assert.equal(noop.affectedRows, 60);
			assert.equal(noop.insertId, 0);
			const update = await db.addTransactions(
				transactions.map((tx, index) =>
					index === 0 ? { ...tx, version: 3 } : tx,
				),
			);
			assert.equal(update.affectedRows, 61);
			assert.equal(
				update.insertId,
				await db.getTransactionId(transactions[59].txid),
			);
		});
	});

	it("rolls back every chunk when a later input violates a foreign key", async () => {
		await withSmallPackets(async () => {
			const parent = await db.ensureTransactionId("chunk-funding");
			const spender = await db.ensureTransactionId("chunk-spender");
			const addrID = await db.ensureAddressId("chunk-funded-address");
			await db.addOutputs([
				{
					txnID: parent,
					addrID,
					outIndex: 0,
					outAmount: 100,
					outScript: "a".repeat(2000),
				},
			]);
			const outID = (
				await db.getOutputIds([{ txid: "chunk-funding", vout: 0 }])
			)[0].outID;
			await assert.rejects(
				db.addInputs(
					Array.from({ length: 100 }, (_, index) => ({
						txnID: spender,
						outID: index === 99 ? 0 : outID,
						inIndex: index,
						inSequence: 1,
					})),
				),
				{ code: "ER_NO_REFERENCED_ROW_2" },
			);
			assert.deepEqual(await db.getTxInputs(spender), []);
			assert.equal(db.pool.activeConnections(), 0);
		});
	});

	it("preserves chunked upsert metadata when found-row reporting is disabled", async () => {
		await withSmallPackets(async () => {
			const transactions = Array.from({ length: 60 }, (_, index) => ({
				txid: `found-rows-off-${index}`,
				version: 1,
				locktime: 0,
				created: 100,
			}));
			await db.addTransactions(transactions);
			const noop = await db.addTransactions(transactions);
			assert.equal(noop.affectedRows, 0);
			assert.equal(noop.insertId, 0);
			const updated = await db.addTransactions(
				transactions.map((tx, index) =>
					index === 0 ? { ...tx, version: 2 } : tx,
				),
			);
			assert.equal(updated.affectedRows, 2);
			assert.equal(
				updated.insertId,
				await db.getTransactionId(transactions[59].txid),
			);
		}, false);
	});

	it("applies the index migration repeatedly without changing stored outpoints", async () => {
		const requested = [{ txid: "a".repeat(64), vout: 0 }];
		const before = await db.getOutputIds(requested);
		await admin.query(
			await readFile(
				new URL("../../../db-scripts/2_update.sql", import.meta.url),
				"utf8",
			),
		);
		const indexes = await admin.query<{ Column_name: string }[]>(
			"SHOW INDEX FROM outputs WHERE Key_name = 'outputs_txn_out_index'",
		);
		assert.deepEqual(
			indexes.map((index) => index.Column_name),
			["txnID", "outIndex"],
		);
		assert.deepEqual(await db.getOutputIds(requested), before);
	});

	it("orders transactions with equal times consistently across pages", async () => {
		const addrID = await db.ensureAddressId("equal-time-address");
		for (const txid of ["tie-first", "tie-second", "tie-third"]) {
			await db.addTransaction({
				txid,
				created: 12345,
				version: 1,
				locktime: 0,
			});
			const txnID = await db.getTransactionId(txid);
			await db.addOutputs([
				{ txnID, addrID, outIndex: 0, outAmount: 1, outScript: "00" },
			]);
		}
		const first = await db.getTxsByAddrAndXpubs(
			["equal-time-address"],
			[],
			0,
			2,
		);
		const second = await db.getTxsByAddrAndXpubs(
			["equal-time-address"],
			[],
			1,
			2,
		);
		assert.deepEqual(
			first.map((tx) => tx.hash),
			["tie-third", "tie-second"],
		);
		assert.deepEqual(
			second.map((tx) => tx.hash),
			["tie-first"],
		);
	});

	it("serves concurrent streaming reads with a single pooled connection", async () => {
		db.connect({ ...connectionConfig, database, connectionLimit: 1 });
		await vi.waitFor(() => assert.equal(db.lockReconnect, false));
		const [ids, ownership, grouped, transaction, page] = await Promise.all([
			db.getAddressesIds(["single-incoming"]),
			db.getXpubByAddresses(["single-incoming"]),
			db.getHDAccountsByAddresses(["single-incoming"]),
			db.getTransaction("2".repeat(64)),
			db.getTxsByAddrAndXpubs([], ["response-single-xpub"], 0, 10),
		]);
		assert.equal(typeof ids["single-incoming"], "number");
		assert.deepEqual(ownership, { "single-incoming": "response-single-xpub" });
		assert.equal(grouped.hd["response-single-xpub"].addresses.length, 1);
		assert.equal(transaction.out.length, 2);
		assert.equal(page.length, 2);
		assert.equal(db.pool.activeConnections(), 0);
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

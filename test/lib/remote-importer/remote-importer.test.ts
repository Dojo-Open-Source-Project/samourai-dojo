import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import hdaHelper from "../../../lib/bitcoin/hd-accounts-helper.js";
import db from "../../../lib/db/mysql-db-wrapper.js";
import errors from "../../../lib/errors.js";
import Logger from "../../../lib/logger.js";

const XPUB =
	"tpubDDDAe7GgFT4fzEzKwWVA4BWo8fiJXQeGEYDTexzo2w6CK1iDoLPYkpEisXo623ieF79GQ3xpcEVN1vcQhX2sysyL8o1XqzBmQb9JReTxQ7w";

function deferred() {
	let resolve: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve: () => resolve() };
}

describe("Local remote imports", () => {
	let importer: typeof import("../../../lib/remote-importer/remote-importer.js").default;
	let restore: () => void;

	before(async () => {
		// Stub external connections while exercising the real importer entry points.
		const base = new URL("../../../lib/", import.meta.url);
		const stubs = new Map([
			[new URL("bitcoind-rpc/latest-block.js", base).href, "export default {}"],
			[
				new URL("remote-importer/sources-testnet.js", base).href,
				"export default class {}",
			],
			[
				new URL("remote-importer/sources-mainnet.js", base).href,
				"export default class {}",
			],
		]);
		const hooks = registerHooks({
			resolve(specifier, context, nextResolve) {
				const resolved = nextResolve(specifier, context);
				const stub = stubs.get(resolved.url);
				return stub === undefined
					? resolved
					: {
							url: `data:text/javascript,${encodeURIComponent(stub)}`,
							shortCircuit: true,
						};
			},
		});
		try {
			importer = (
				await import("../../../lib/remote-importer/remote-importer.js")
			).default;
		} finally {
			hooks.deregister();
		}
	});

	beforeEach(() => {
		const scan = importer.xpubScan;
		const transactions = importer._importTransactions;
		const addresses = importer.sources.getAddresses;
		const ensure = db.ensureHDAccountId;
		const add = db.addAddresses;
		const log = Logger.info;
		const logError = Logger.error;
		restore = () => {
			importer.xpubScan = scan;
			importer._importTransactions = transactions;
			importer.sources.getAddresses = addresses;
			db.ensureHDAccountId = ensure;
			db.addAddresses = add;
			Logger.info = log;
			Logger.error = logError;
		};
		importer.xpubScan = async () => ({ addresses: [], transactions: [] });
		importer._importTransactions = async () => {};
		importer.sources.getAddresses = async () => [];
		db.ensureHDAccountId = async () => 1;
		db.addAddresses = async () => [];
		Logger.info = () => {};
		Logger.error = () => {};
	});

	afterEach(() => restore());

	it("claims before yielding, reports progress, and rejects overlaps without clearing the guard", async () => {
		const scanned = deferred();
		const storing = deferred();
		const stored = deferred();
		importer.xpubScan = async () => {
			await scanned.promise;
			return { addresses: [], transactions: [] };
		};
		importer._importTransactions = async () => {
			storing.resolve();
			await stored.promise;
		};
		const active = importer.importHDAccount(XPUB, hdaHelper.BIP44);
		try {
			assert.deepEqual(importer.importInProgress(XPUB), {
				status: "rescan",
				txs_ext: 0,
				txs_int: 0,
			});
			await assert.rejects(
				importer.importHDAccount(XPUB, hdaHelper.BIP44),
				(error: unknown) => error === errors.xpub.OVERLAP,
			);
			assert.ok(importer.importInProgress(XPUB));
			scanned.resolve();
			await storing.promise;
			assert.deepEqual(importer.importInProgress(XPUB), {
				status: "import",
				txs: 0,
			});
		} finally {
			scanned.resolve();
			stored.resolve();
			await active;
		}
		assert.equal(importer.importInProgress(XPUB), null);
	});

	it("releases an xpub guard after an import fails so the import can be retried", async () => {
		importer.xpubScan = async () => {
			throw new Error("Scan failed");
		};
		await importer.importHDAccount(XPUB, hdaHelper.BIP44);
		assert.equal(importer.importInProgress(XPUB), null);
		importer.xpubScan = async () => ({ addresses: [], transactions: [] });
		await importer.importHDAccount(XPUB, hdaHelper.BIP44);
		assert.equal(importer.importInProgress(XPUB), null);
	});

	it("deduplicates loose addresses and releases only the guards acquired by each import", async () => {
		const scanned = deferred();
		const calls: string[][] = [];
		importer.sources.getAddresses = async (addresses) => {
			calls.push([...addresses]);
			if (addresses.includes("first")) await scanned.promise;
			return [];
		};
		const active = importer.importAddresses(["first", "first"]);
		try {
			await importer.importAddresses(["first", "second", "second"]);
			assert.deepEqual(calls, [["first"], ["second"]]);
			assert.equal(importer.importInProgress("first"), true);
			assert.equal(importer.importInProgress("second"), null);
		} finally {
			scanned.resolve();
			await active;
		}
		assert.equal(importer.importInProgress("first"), null);
	});

	it("releases every acquired loose-address guard when scanning fails", async () => {
		importer.sources.getAddresses = async () => {
			throw new Error("Scan failed");
		};
		await importer.importAddresses(["first", "second"]);
		assert.equal(importer.importInProgress("first"), null);
		assert.equal(importer.importInProgress("second"), null);
	});
});

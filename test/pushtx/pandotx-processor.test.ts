import * as bitcoin from "bitcoinjs-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Logger from "../../lib/logger.js";
import PandoTxProcessor from "../../pushtx/pandotx-processor.js";

const mocks = vi.hoisted(() => ({
	directoryList: vi.fn(),
	directoryAdd: vi.fn(),
	getrawtransaction: vi.fn(),
	pushTx: vi.fn(),
}));

vi.mock("../../keys/index.js", () => ({
	default: {
		testnet: {
			pandoTx: {
				process: "active",
				keyPush: "test-push",
				keyResults: "test-results",
			},
			soroban: { rpc: "http://soroban.test" },
		},
	},
}));
vi.mock("soroban-client-nodejs", () => ({
	RPC: class {
		directoryList = mocks.directoryList;
		directoryAdd = mocks.directoryAdd;
	},
}));
vi.mock("../../lib/bitcoind-rpc/rpc-client.js", () => ({
	createRpcClient: () => ({ getrawtransaction: mocks.getrawtransaction }),
}));
vi.mock("../../pushtx/pushtx-processor.js", () => ({
	default: { pushTx: mocks.pushTx },
}));

function transaction(index: number) {
	const tx = new bitcoin.Transaction();
	tx.addInput(Buffer.alloc(32), index);
	tx.addOutput(Buffer.from([0x51]), 1000);
	return { raw: tx.toHex(), txid: tx.getId() };
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.spyOn(Logger, "info").mockImplementation(() => {});
	vi.spyOn(Logger, "error").mockImplementation(() => {});
	mocks.directoryList.mockResolvedValue([]);
	mocks.directoryAdd.mockResolvedValue(undefined);
	mocks.getrawtransaction.mockRejectedValue(new Error("Transaction not found"));
	mocks.pushTx.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("PandoTx polling", () => {
	it("contains malformed entries and processes valid transactions in the same and subsequent batches", async () => {
		const first = transaction(0);
		const second = transaction(1);
		mocks.directoryList
			.mockResolvedValueOnce(["not a transaction", first.raw])
			.mockResolvedValueOnce(["not a transaction", first.raw, second.raw]);
		const processor = new PandoTxProcessor();

		await expect(processor.processTxs()).resolves.toBeUndefined();
		expect(mocks.pushTx).toHaveBeenCalledExactlyOnceWith(first.raw, true);
		expect(mocks.directoryAdd).toHaveBeenCalledExactlyOnceWith(
			"test-results",
			first.txid,
			"short",
		);

		await expect(processor.processTxs()).resolves.toBeUndefined();
		expect(mocks.pushTx.mock.calls).toEqual([
			[first.raw, true],
			[second.raw, true],
		]);
		expect(mocks.directoryAdd).toHaveBeenLastCalledWith(
			"test-results",
			second.txid,
			"short",
		);
		expect(Logger.error).toHaveBeenCalledTimes(2);
	});

	it("isolates a failed broadcast and allows it to be retried without rebroadcasting successful entries", async () => {
		const failed = transaction(0);
		const healthy = transaction(1);
		const failure = new Error("Broadcast failed");
		mocks.directoryList.mockResolvedValue([failed.raw, healthy.raw]);
		mocks.pushTx.mockImplementation(async (raw: string) => {
			if (raw === failed.raw) throw failure;
		});
		const processor = new PandoTxProcessor();

		await expect(processor.processTxs()).resolves.toBeUndefined();
		expect(mocks.directoryAdd).toHaveBeenCalledExactlyOnceWith(
			"test-results",
			healthy.txid,
			"short",
		);
		expect(Logger.error).toHaveBeenCalledWith(
			failure,
			`PandoTx : Error while processing transaction ${failed.txid}`,
		);

		mocks.pushTx.mockResolvedValue(undefined);
		await processor.processTxs();
		expect(mocks.pushTx.mock.calls).toEqual([
			[failed.raw, true],
			[healthy.raw, true],
			[failed.raw, true],
		]);
		expect(mocks.directoryAdd).toHaveBeenLastCalledWith(
			"test-results",
			failed.txid,
			"short",
		);
	});

	it("contains an acknowledgement failure without failing other entries", async () => {
		const first = transaction(0);
		const second = transaction(1);
		const failure = new Error("Soroban unavailable");
		mocks.directoryList.mockResolvedValue([first.raw, second.raw]);
		mocks.directoryAdd.mockRejectedValueOnce(failure);

		await expect(new PandoTxProcessor().processTxs()).resolves.toBeUndefined();
		expect(mocks.directoryAdd).toHaveBeenCalledTimes(2);
		expect(Logger.error).toHaveBeenCalledWith(
			failure,
			`PandoTx : Error while processing transaction ${first.txid}`,
		);
	});

	it("continues skipping transactions already known to Bitcoin Core", async () => {
		const known = transaction(0);
		mocks.directoryList.mockResolvedValue([known.raw]);
		mocks.getrawtransaction.mockResolvedValue(known.raw);

		await new PandoTxProcessor().processTxs();
		expect(mocks.pushTx).not.toHaveBeenCalled();
		expect(mocks.directoryAdd).not.toHaveBeenCalled();
	});

	it("catches polling rejection at the timer boundary and processes the next tick", async () => {
		vi.useFakeTimers();
		const failure = new Error("Directory unavailable");
		const valid = transaction(0);
		mocks.directoryList
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(["malformed", valid.raw]);
		const processor = new PandoTxProcessor();
		processor.start();
		try {
			await vi.advanceTimersByTimeAsync(500);
			expect(Logger.error).toHaveBeenCalledExactlyOnceWith(
				failure,
				"PandoTx : Error while polling transactions",
			);
			await vi.advanceTimersByTimeAsync(500);
			expect(mocks.pushTx).toHaveBeenCalledExactlyOnceWith(valid.raw, true);
			expect(mocks.directoryAdd).toHaveBeenCalledExactlyOnceWith(
				"test-results",
				valid.txid,
				"short",
			);
		} finally {
			processor.stop();
		}
		await vi.advanceTimersByTimeAsync(500);
		expect(mocks.directoryList).toHaveBeenCalledTimes(2);
	});
});

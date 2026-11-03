import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	BlockHeader,
	DojoRpcClient,
} from "../../../lib/bitcoind-rpc/rpc-client.js";

const mocks = vi.hoisted(() => ({
	rpc: {
		getbestblockhash: vi.fn<DojoRpcClient["getbestblockhash"]>(),
		getblockheader: vi.fn<DojoRpcClient["getblockheader"]>(),
	},
	wait: vi.fn<() => Promise<void>>(),
	info: vi.fn(),
	error: vi.fn(),
}));

vi.mock("../../../lib/bitcoind-rpc/rpc-client.js", () => ({
	createRpcClient: () => mocks.rpc,
	waitForBitcoindRpcApi: mocks.wait,
}));
vi.mock("../../../lib/logger.js", () => ({
	default: { info: mocks.info, error: mocks.error },
}));
vi.mock("zeromq/v5-compat.js", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		default: {
			socket: () =>
				Object.assign(new EventEmitter(), {
					connect: vi.fn(),
					subscribe: vi.fn(),
					close: vi.fn(),
				}),
		},
	};
});

const header = (height = 100): BlockHeader => ({
	hash: "A",
	height,
	time: 123,
	mediantime: 120,
	difficulty: 42,
	previousblockhash: "previous",
});
const flush = () => vi.advanceTimersByTimeAsync(0);
let latest: typeof import("../../../lib/bitcoind-rpc/latest-block.js").default;
const load = async () => {
	latest = (await import("../../../lib/bitcoind-rpc/latest-block.js")).default;
	await flush();
	return latest;
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetModules();
	vi.resetAllMocks();
	mocks.wait.mockResolvedValue();
	mocks.rpc.getbestblockhash.mockResolvedValue("A");
	mocks.rpc.getblockheader.mockResolvedValue(header());
});

afterEach(() => {
	latest?.close();
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("LatestBlock", () => {
	it("initializes all cached fields from the active RPC tip", async () => {
		await load();
		expect(latest).toMatchObject({
			hash: "A",
			height: 100,
			time: 120,
			diff: 42,
		});
		expect(vi.getTimerCount()).toBe(0);
	});

	it("coalesces a burst into one active request and one pending refresh", async () => {
		const pending = Promise.withResolvers<BlockHeader>();
		mocks.rpc.getblockheader.mockReturnValueOnce(pending.promise);
		await load();
		for (let i = 0; i < 1000; i++) {
			(latest.sock as unknown as EventEmitter).emit(
				"message",
				Buffer.from("hashblock"),
				Buffer.from("aa", "hex"),
			);
		}
		expect(mocks.rpc.getbestblockhash).toHaveBeenCalledTimes(1);
		expect(mocks.rpc.getblockheader).toHaveBeenCalledTimes(1);
		pending.resolve(header());
		await flush();
		expect(mocks.rpc.getbestblockhash).toHaveBeenCalledTimes(2);
		expect(mocks.rpc.getblockheader).toHaveBeenCalledTimes(2);
		expect(mocks.info).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("bounds outage retries despite notifications and recovers without a new event", async () => {
		mocks.rpc.getblockheader.mockRejectedValue(new Error("connection refused"));
		await load();
		for (let i = 0; i < 1000; i++) latest.onBlockHash(`notification-${i}`);
		await vi.advanceTimersByTimeAsync(1999);
		expect(mocks.rpc.getblockheader).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.rpc.getblockheader).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(4000);
		expect(mocks.rpc.getblockheader).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(90000);
		expect(mocks.rpc.getblockheader).toHaveBeenCalledTimes(6);
		expect(vi.getTimerCount()).toBe(1);

		mocks.rpc.getbestblockhash.mockResolvedValue("recovered-tip");
		mocks.rpc.getblockheader.mockResolvedValue(header(110));
		await vi.advanceTimersByTimeAsync(30000);
		expect(latest).toMatchObject({ hash: "recovered-tip", height: 110 });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("retries warmup errors, then resets the retry budget after success", async () => {
		mocks.rpc.getblockheader.mockRejectedValueOnce(
			new Error("Code: -28, Loading block index"),
		);
		await load();
		await vi.advanceTimersByTimeAsync(2000);
		expect(latest.hash).toBe("A");
		mocks.rpc.getblockheader.mockRejectedValueOnce(new Error("disconnected"));
		latest.onBlockHash("B");
		await flush();
		mocks.rpc.getbestblockhash.mockResolvedValue("B");
		await vi.advanceTimersByTimeAsync(2000);
		expect(latest.hash).toBe("B");
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		"Invalid credentials",
		"Code: -32601, Method not found",
		"Code: -5, Block not found",
	])("uses slow recovery for permanent RPC failure: %s", async (message) => {
		mocks.rpc.getblockheader.mockRejectedValueOnce(new Error(message));
		await load();
		latest.onBlockHash("B");
		await vi.advanceTimersByTimeAsync(29999);
		expect(mocks.rpc.getblockheader).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(latest.hash).toBe("A");
	});

	it("handles an initial getbestblockhash failure through the same recovery path", async () => {
		mocks.rpc.getbestblockhash.mockRejectedValueOnce(new Error("unavailable"));
		await load();
		expect(latest.hash).toBeNull();
		expect(mocks.error).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(2000);
		expect(latest.hash).toBe("A");
	});

	it("does not publish an older header when a new notification arrives in flight", async () => {
		await load();
		const older = Promise.withResolvers<BlockHeader>();
		const newer = Promise.withResolvers<BlockHeader>();
		mocks.rpc.getbestblockhash
			.mockResolvedValueOnce("B")
			.mockResolvedValueOnce("C");
		mocks.rpc.getblockheader
			.mockReturnValueOnce(older.promise)
			.mockReturnValueOnce(newer.promise);
		latest.onBlockHash("B");
		await flush();
		latest.onBlockHash("C");
		older.resolve(header(101));
		await flush();
		expect(latest.hash).toBe("A");
		expect(mocks.info).toHaveBeenCalledTimes(1);
		newer.resolve(header(102));
		await flush();
		expect(latest).toMatchObject({ hash: "C", height: 102 });
	});

	it("skips a superseded best-hash response before fetching its header", async () => {
		const pending = Promise.withResolvers<string>();
		mocks.rpc.getbestblockhash.mockReturnValueOnce(pending.promise);
		await load();
		latest.onBlockHash("B");
		mocks.rpc.getbestblockhash.mockResolvedValue("B");
		pending.resolve("A");
		await flush();
		expect(mocks.rpc.getblockheader).toHaveBeenCalledTimes(1);
		expect(mocks.rpc.getblockheader.mock.calls[0][0]).toEqual({
			blockhash: "B",
		});
		expect(latest.hash).toBe("B");
	});

	it.each([100, 99])(
		"accepts an active-chain reorg to height %i",
		async (height) => {
			await load();
			mocks.rpc.getbestblockhash.mockResolvedValue("reorg");
			mocks.rpc.getblockheader.mockResolvedValue(header(height));
			latest.onBlockHash("reorg");
			await flush();
			expect(latest).toMatchObject({ hash: "reorg", height });
			// A -> B -> A is a new notification, not a cached-hash duplicate.
			mocks.rpc.getbestblockhash.mockResolvedValue("A");
			latest.onBlockHash("A");
			await flush();
			expect(latest.hash).toBe("A");
		},
	);

	it("aborts a stuck transport before scheduling another attempt", async () => {
		let signal: AbortSignal;
		mocks.rpc.getbestblockhash.mockImplementationOnce(
			(options) =>
				new Promise((_resolve, reject) => {
					signal = options.abortSignal;
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				}),
		);
		await load();
		await vi.advanceTimersByTimeAsync(10000);
		expect(signal.aborted).toBe(true);
		expect(mocks.rpc.getbestblockhash).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(2000);
		expect(latest.hash).toBe("A");
	});

	it("retains the cached tip during outages and cancels recovery on close", async () => {
		await load();
		mocks.rpc.getblockheader.mockRejectedValue(new Error("unavailable"));
		latest.onBlockHash("B");
		await flush();
		expect(latest.hash).toBe("A");
		latest.close();
		latest.close();
		latest.onBlockHash("C");
		await vi.advanceTimersByTimeAsync(60000);
		expect(mocks.rpc.getbestblockhash).toHaveBeenCalledTimes(2);
		expect(latest.sock.close).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not publish an in-flight result after close", async () => {
		const pending = Promise.withResolvers<BlockHeader>();
		mocks.rpc.getblockheader.mockReturnValueOnce(pending.promise);
		await load();
		const signal = mocks.rpc.getblockheader.mock.calls[0][1].abortSignal;
		latest.close();
		expect(signal.aborted).toBe(true);
		pending.resolve(header());
		await flush();
		expect(latest.hash).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
});

import assert from "node:assert/strict";
import { FeeEstimator } from "@dojo-tools/next-block-estimator";
import { afterAll, describe, expect, it, vi } from "vitest";
import errors from "../../../lib/errors.js";

vi.mock("@dojo-tools/next-block-estimator", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		FeeEstimator: vi.fn(
			class extends EventEmitter {
				stop = vi.fn();
			},
		),
	};
});
vi.mock("../../../lib/bitcoind-rpc/latest-block.js", () => ({ default: {} }));
vi.mock("../../../lib/bitcoind-rpc/rpc-client.js", () => ({
	createRpcClient: () => ({ batch: async (): Promise<never[]> => [] }),
	waitForBitcoindRpcApi: async () => {},
}));

describe("Accounts fee estimator", () => {
	let fees: typeof import("../../../lib/bitcoind-rpc/fees.js").default;

	afterAll(() => fees?.close());

	it("owns one worker, shares ready estimates, retains cached fees, and stops the worker on shutdown", async () => {
		fees = (await import("../../../lib/bitcoind-rpc/fees.js")).default;
		expect(FeeEstimator).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ useWorker: true, refresh: 20 }),
		);
		const estimator = vi.mocked(FeeEstimator).mock.instances[0];
		assert.throws(
			() => fees.getEstimatorFees(),
			(error: unknown) => error === errors.estimator.NOT_AVAILABLE,
		);
		const first = {
			"0.1": 1,
			"0.2": 2,
			"0.5": 3,
			"0.9": 4,
			"0.99": 5,
			"0.999": 6,
		};
		estimator.emit("data", { ready: true, fees: first });
		assert.strictEqual(fees.getEstimatorFees(), first);
		assert.strictEqual(fees.getEstimatorFees(), first);
		estimator.emit("data", { ready: false, fees: {} });
		assert.strictEqual(fees.getEstimatorFees(), first);
		const second = { ...first, "0.5": 4 };
		estimator.emit("data", { ready: true, fees: second });
		assert.strictEqual(fees.getEstimatorFees(), second);
		fees.close();
		fees.close();
		expect(estimator.stop).toHaveBeenCalledTimes(1);
	});
});

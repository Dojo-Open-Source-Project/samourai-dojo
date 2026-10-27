import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import errors from "../../../lib/errors.js";

const asModule = (source: string) =>
	`data:text/javascript,${encodeURIComponent(source)}`;

const estimatorModule = asModule(`
import { EventEmitter } from 'node:events';
export class FeeEstimator extends EventEmitter {
  static instances = [];
  stopCalls = 0;
  constructor(options) {
    super();
    this.options = options;
    FeeEstimator.instances.push(this);
  }
  stop() { this.stopCalls++; }
}
`);

describe("Accounts fee estimator", () => {
	let fees: typeof import("../../../lib/bitcoind-rpc/fees.js").default;

	before(async () => {
		const base = new URL("../../../lib/bitcoind-rpc/", import.meta.url);
		const stubs = new Map([
			[new URL("latest-block.js", base).href, asModule("export default {}")],
			[
				new URL("rpc-client.js", base).href,
				asModule(`
export const createRpcClient = () => ({ batch: async () => [] });
export const waitForBitcoindRpcApi = async () => {};
`),
			],
		]);
		const hooks = registerHooks({
			resolve(specifier, context, nextResolve) {
				if (specifier === "@dojo-tools/next-block-estimator")
					return { url: estimatorModule, shortCircuit: true };
				const resolved = nextResolve(specifier, context);
				const stub = stubs.get(resolved.url);
				return stub === undefined
					? resolved
					: { url: stub, shortCircuit: true };
			},
		});
		try {
			fees = (await import("../../../lib/bitcoind-rpc/fees.js")).default;
		} finally {
			hooks.deregister();
		}
	});

	after(() => fees?.close());

	it("owns one worker, shares ready estimates, retains cached fees, and stops the worker on shutdown", async () => {
		const { FeeEstimator } = await import(estimatorModule);
		assert.equal(FeeEstimator.instances.length, 1);
		const estimator = FeeEstimator.instances[0];
		assert.equal(estimator.options.useWorker, true);
		assert.equal(estimator.options.refresh, 20);
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
		assert.equal(estimator.stopCalls, 1);
	});
});

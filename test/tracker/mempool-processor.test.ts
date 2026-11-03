import { EventEmitter } from "node:events";
import * as bitcoin from "bitcoinjs-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import Logger from "../../lib/logger.js";
import MempoolProcessor from "../../tracker/mempool-processor.js";

vi.mock("zeromq/v5-compat.js", () => ({
	default: {
		socket: vi.fn(() =>
			Object.assign(new EventEmitter(), {
				connect: vi.fn(),
				subscribe: vi.fn(),
				close: vi.fn(),
			}),
		),
	},
}));
vi.mock("../../lib/bitcoind-rpc/rpc-client.js", () => ({
	createRpcClient: () => ({}),
}));
vi.mock("../../lib/db/mysql-db-wrapper.js", () => ({ default: {} }));

afterEach(() => vi.restoreAllMocks());

describe("Mempool rawtx notifications", () => {
	it("contains a malformed notification and buffers the next valid transaction", () => {
		vi.spyOn(Logger, "info").mockImplementation(() => {});
		const logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
		const processor = new MempoolProcessor();
		processor.isActive = true;
		processor.initSockets();
		const socket = processor.txSock as unknown as EventEmitter;
		const topic = Buffer.from("rawtx");

		expect(() => socket.emit("message", topic, Buffer.alloc(0))).not.toThrow();
		expect(processor.mempoolBuffer.size()).toBe(0);
		expect(logError).toHaveBeenCalledExactlyOnceWith(
			undefined,
			"Tracker : MempoolProcessor.onTx() - rejected rawtx notification (0 bytes)",
		);

		const tx = new bitcoin.Transaction();
		tx.addInput(Buffer.alloc(32), 0);
		tx.addOutput(Buffer.from([0x51]), 1000);
		socket.emit("message", topic, tx.toBuffer());
		expect(processor.mempoolBuffer.toArray().map((tx) => tx.txid)).toEqual([
			tx.getId(),
		]);
		processor.stop();
	});
});

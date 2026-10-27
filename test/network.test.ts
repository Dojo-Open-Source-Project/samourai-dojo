/**
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import assert from "node:assert/strict";
import * as bitcoin from "bitcoinjs-lib";
import { describe, it } from "vitest";
import network from "../lib/bitcoin/network.js";

describe("InitTest", () => {
	describe("initTests()", () => {
		it("should successfully initialize testnet", () => {
			assert.equal(network.key, "testnet");
			assert.strictEqual(network.network, bitcoin.networks.testnet);
		});
	});
});

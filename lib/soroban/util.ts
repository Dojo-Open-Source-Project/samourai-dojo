/*!
 * lib/soroban/util.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { RPC } from "soroban-client-nodejs";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";
import util from "../util.js";

/**
 * @description Class providing utility functions as static methods
 */
const SorobanUtil = {
	/**
	 * Check if the Soroban rpc api is ready to process requests
	 */
	waitForSorobanRpcApi: async (): Promise<void> => {
		const keys = keysFile[
			network.key as keyof typeof keysFile
		] as unknown as DojoConfig;
		let sorobanRpc = null;
		try {
			const sorobanUrl = keys.soroban?.rpc;
			if (typeof sorobanUrl !== "string") {
				throw new Error("Missing Soroban RPC URL");
			}
			const socks5ProxyUrl = sorobanUrl.includes(".onion")
				? keys.soroban?.socks5Proxy
				: null;
			sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl);
			await sorobanRpc.directoryList("test.start");
		} catch {
			sorobanRpc = null;
			Logger.info(
				"SorobanUtil : Soroban RPC API is still unreachable. New attempt in 20s.",
			);
			await util.delay(20000);
			return await SorobanUtil.waitForSorobanRpcApi();
		}
	},
};

export default SorobanUtil;

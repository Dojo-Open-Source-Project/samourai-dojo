/*!
 * lib/bitcoind_rpc/rpc-client.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { RPCClient, type RPCOptions } from "@dojo-tools/bitcoin-rpc";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import Logger from "../logger.js";
import util from "../util.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONType | JSONValue[];
export type JSONType = {
	[member: string]: JSONValue;
};

export interface RPCSuccessResponse<T extends JSONValue = JSONValue> {
	id: number | string;
	result: T;
}

export interface RPCErrorResponse {
	id: number | string;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
}

export interface NetworkInfo {
	subversion: string;
	version?: number;
	protocolversion?: number;
	connections?: number;
	relayfee?: number;
}

export interface BlockchainInfo {
	blocks: number;
	headers: number;
	chain: string;
}

export interface BlockHeader {
	hash: string;
	height: number;
	time: number;
	mediantime: number;
	difficulty: number;
	previousblockhash: string;
}

export interface FeeEstimate {
	errors?: string[];
	feerate?: number;
}

export interface RpcBatchSuccess<T extends JSONValue = JSONValue> {
	id: string | number;
	result: T;
}

export type RpcBatchResponse<T extends JSONValue = JSONValue> =
	| RpcBatchSuccess<T>
	| RPCErrorResponse;

export interface DojoRpcClient {
	batch(
		rpcRequests: Array<{
			method: string;
			params: JSONType;
			id?: string | number;
		}>,
	): Promise<Array<RPCSuccessResponse | RPCErrorResponse>>;
	getnetworkinfo(): Promise<NetworkInfo>;
	getmempoolinfo(): Promise<JSONType>;
	getbestblockhash(): Promise<string>;
	getblockcount(): Promise<number>;
	getblockheader(params: {
		blockhash: string;
		verbose?: boolean;
	}): Promise<BlockHeader>;
	getrawtransaction(params: {
		txid: string;
		verbose: true;
		blockhash?: string;
	}): Promise<JSONType>;
	getrawtransaction(params: {
		txid: string;
		verbose: false;
		blockhash?: string;
	}): Promise<string>;
	getrawmempool(params?: {
		verbose?: boolean;
		mempool_sequence?: boolean;
	}): Promise<JSONType | string[]>;
	getblock(params: {
		blockhash: string;
		verbosity: 0 | 1 | 2;
	}): Promise<JSONType | string>;
	getblockhash(params: { height: number }): Promise<string>;
	getblockchaininfo(): Promise<BlockchainInfo>;
	getblocktemplate(params: JSONType): Promise<JSONType>;
	gettxout(params: {
		txid: string;
		n: number;
		include_mempool?: boolean;
	}): Promise<{
		bestblock: string;
		confirmations: number;
		value: number;
		scriptPubKey: {
			asm: string;
			desc: string;
			hex: string;
			address: string;
			type: string;
		};
		coinbase: boolean;
	} | null>;
	scantxoutset(params: {
		action: "start" | "abort" | "status";
		scanobjects:
			| string[]
			| Array<{ desc: string; range?: number | [number, number] }>;
	}): Promise<JSONType>;
	sendrawtransaction(params: {
		hexstring: string;
		maxfeerate?: number | string;
	}): Promise<string>;
}

/**
 * Wrapper for bitcoind rpc client
 */
export const createRpcClient = (options: RPCOptions = {}): DojoRpcClient => {
	return new RPCClient({
		host: keys.bitcoind.rpc.host,
		port: keys.bitcoind.rpc.port,
		protocol: "http",
		username: keys.bitcoind.rpc.user,
		password: keys.bitcoind.rpc.pass,
		timeout: 2 * 60 * 1000, // 2 minutes
		...options,
	}) as unknown as DojoRpcClient;
};

/**
 * Check if an error returned by bitcoin-rpc-client
 * is a connection error.
 */
export const isConnectionError = (error?: unknown) => {
	if (typeof error !== "string") return false;

	const isTimeoutError = error.includes("connect ETIMEDOUT");
	const isConnRejected = error.includes("Connection Rejected");

	return isTimeoutError || isConnRejected;
};

/**
 * Check if the rpc api is ready to process requests
 */
export const waitForBitcoindRpcApi = async (): Promise<void> => {
	let client: DojoRpcClient | null = createRpcClient();

	try {
		const networkInfo = await client.getnetworkinfo();

		if (networkInfo.subversion.includes("Knots")) {
			Logger.error(
				null,
				`Unsupported Bitcoin client detected: ${networkInfo.subversion}. Exiting...`,
			);
			process.exit(0);
		}
	} catch {
		client = null;
		Logger.info("Bitcoind RPC : API is still unreachable. New attempt in 20s.");
		await util.delay(20000);
		return await waitForBitcoindRpcApi();
	}
};

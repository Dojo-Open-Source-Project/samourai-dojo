type UnknownRecord = Record<string, unknown>;
interface DojoDbConfig {
	user: string;
	pass: string;
	host: string;
	port: number;
	database: string;
	acquireTimeout?: number;
	connectionLimitApi: number;
	connectionLimitTracker: number;
	connectionLimitPushTxApi: number;
	connectionLimitPushTxOrchestrator: number;
}

interface DojoConfig {
	dojoVersion: string;
	bitcoind: {
		rpc: {
			user: string;
			pass: string;
			host: string;
			port: number;
		};
		zmqTx: string;
		zmqBlk: string;
		feeType: string;
	};
	db: DojoDbConfig;
	apiBind: string;
	ports: {
		account: number;
		pushtx: number;
		trackerApi: number;
		tracker: number;
		orchestrator: number;
		notifpushtx: number;
		notifpushtxOrchestrator: number;
	};
	prefixes: Record<string, string>;
	auth: {
		activeStrategy?: string | null;
		mandatory: boolean;
		strategies: {
			localApiKey: {
				adminKey: string;
				apiKeys: string[];
			};
			auth47?: {
				hostname?: string;
				paymentCodes?: string[];
			};
		};
		auth47?: {
			url: string;
			host: string;
			port: number;
			protocol: string;
		};
		jwt: {
			secret: string;
			accessToken: { expires: string | number };
			refreshToken: { expires: string | number };
		};
	};
	indexer: {
		active: string;
		socks5Proxy?: string | null;
		localIndexer: {
			host: string;
			port: number;
			batchRequests: string;
			protocol?: "tcp" | "tls" | null;
			externalUri?: string | null;
			type?: string;
		};
		oxt?: string;
		esplora?: string;
	};
	gap: {
		external: number;
		internal: number;
	};
	addrFilterThreshold: number;
	addrDerivationPool: {
		maxNbChildren: number;
		minNbChildren: number;
		thresholdParallelDerivation: number;
	};
	explorer: {
		active?: string | null;
		uri?: string | null;
		[key: string]: unknown;
	};
	soroban?: {
		directoryAdd?: string[];
		url?: string;
		rpc?: string;
		externalRpc?: string | null;
		socks5Proxy?: string | null;
		keyAnnounce?: string;
		keyAuth47?: string;
	};
	pandoTx?: {
		push?: string;
		process?: string;
		keyPush?: string | null;
		keyResults?: string | null;
		fallbackMode?: string | null;
		nbRetries?: number;
		account?: number;
		feePerB?: number;
		feeAddress?: string;
	};
	txsScheduler: {
		maxNbEntries: number;
		maxDeltaHeight: number;
	};
	tracker: {
		mempoolProcessPeriod: number;
		unconfirmedTxsProcessPeriod: number;
	};
	multiaddr: {
		transactions: number;
	};
	[key: string]: unknown;
}

type HttpEnv = {
	Variables: {
		body: Record<string, unknown>;
		user?: UnknownRecord;
		authorizations?: UnknownRecord;
	};
};
type HttpContext = import("hono").Context<HttpEnv>;
type HttpNext = import("hono").Next;

declare module "zeromq/v5-compat.js" {
	type SocketKind = "pub" | "sub" | "push" | "pull" | "req" | "rep" | string;
	type SocketMessagePart = string | Buffer;
	type SocketMessage = SocketMessagePart | SocketMessagePart[];

	interface Socket {
		bind(endpoint: string, callback?: (error?: Error) => void): void;
		close(): void;
		connect(endpoint: string): void;
		on(
			event: "message",
			listener: (topic: Buffer, message: Buffer) => void,
		): this;
		on(event: string, listener: (...args: unknown[]) => void): this;
		send(message: SocketMessage): void;
		subscribe(topic: string): void;
		unsubscribe(topic: string): void;
	}

	const zmq: {
		socket(kind: SocketKind): Socket;
	};

	export type { Socket };
	export default zmq;
}
declare module "soroban-client-nodejs" {
	class RPC {
		constructor(url: string, socks5ProxyUrl?: string | null);
		directoryAdd(
			key: string | null | undefined,
			message: string,
			mode?: string,
		): Promise<unknown>;
		directoryList(key: string | null | undefined): Promise<string[]>;
	}

	class RPCCallError extends Error {}

	export { RPC, RPCCallError };
}

export const REQUEST_TIMEOUT_MS = 5000;
export const NONCE_TTL_MS = 10 * 60 * 1000;
export const FEE_TTL_MS = 60 * 1000;
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const FEE_PERCENTILES = [0.1, 0.2, 0.5, 0.9, 0.99, 0.999] as const;

export interface ImportState {
	status?: string;
	txs_ext?: number;
	txs_int?: number;
	txs?: number;
}

export type ImportProgress = ImportState | true;
export type EstimatorFees = Record<(typeof FEE_PERCENTILES)[number], number>;

export interface EstimatorUpdate {
	ready?: boolean;
	fees?: Record<string, unknown>;
}

export interface FeeSnapshot {
	fees: EstimatorFees;
	updatedAt: number;
}

export interface Operations {
	ping: { args: Record<string, never>; result: boolean };
	"nonce.create": { args: { nonce: string }; result: number };
	"nonce.approve": { args: { nonce: string }; result: boolean };
	"nonce.consume": {
		args: { nonce: string };
		result: "missing" | "pending" | "approved";
	};
	"import.claim": {
		args: { key: string; token: string; progress: ImportProgress };
		result: boolean;
	};
	"import.update": {
		args: { key: string; token: string; progress: ImportProgress };
		result: boolean;
	};
	"import.release": { args: { key: string; token: string }; result: boolean };
	"import.get": { args: { key: string }; result: ImportProgress | null };
	"fees.publish": {
		args: { update: EstimatorUpdate; sequence: number };
		result: boolean;
	};
	"fees.get": { args: Record<string, never>; result: FeeSnapshot | null };
}

export type Operation = keyof Operations;

export interface RpcRequest {
	version: 1;
	id: string;
	epoch: string;
	pid: number;
	deadline: number;
	op: Operation;
	args: unknown;
}

export interface RpcResponse {
	version: 1;
	id: string;
	epoch: string;
	ok: boolean;
	value?: unknown;
	error?: string;
}

export interface CoordinatorConnection {
	endpoint: string;
	epoch: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

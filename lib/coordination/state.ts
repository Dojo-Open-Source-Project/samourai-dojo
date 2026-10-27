import { createHash } from "node:crypto";
import {
	type EstimatorFees,
	FEE_PERCENTILES,
	FEE_TTL_MS,
	type FeeSnapshot,
	type ImportProgress,
	isRecord,
	NONCE_TTL_MS,
	REQUEST_TIMEOUT_MS,
	type RpcRequest,
	type RpcResponse,
} from "./protocol.js";

interface ImportClaim {
	token: string;
	client: string;
	pid: number;
	progress: ImportProgress;
}

interface CachedReply {
	fingerprint: string;
	deadline: number;
	response: RpcResponse;
}

const MAX_NONCES = 1000;
const MAX_IMPORTS = 10000;
const MAX_REPLIES = 20000;

function text(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512)
		throw new Error("Invalid coordinator key");
	return value;
}

function progress(value: unknown): ImportProgress {
	if (value === true) return true;
	if (!isRecord(value)) throw new Error("Invalid import progress");
	const result: Exclude<ImportProgress, true> = {};
	if (value.status !== undefined) result.status = text(value.status);
	for (const key of ["txs_ext", "txs_int", "txs"] as const) {
		if (value[key] !== undefined) {
			if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)
				throw new Error("Invalid import progress count");
			result[key] = value[key] as number;
		}
	}
	return result;
}

/** One synchronous owner for coordination state; mutations never yield. */
export class CoordinatorState {
	private readonly nonces = new Map<
		string,
		{ approved: boolean; expiresAt: number }
	>();
	private readonly imports = new Map<string, ImportClaim>();
	private readonly replies = new Map<string, CachedReply>();
	private fees: FeeSnapshot | null = null;
	private feePublisher: {
		client: string;
		pid: number;
		sequence: number;
	} | null = null;

	constructor(
		readonly epoch: string,
		private readonly ownerIsAlive: (pid: number) => boolean = () => true,
	) {}

	ownerPids(): number[] {
		return [...new Set([...this.imports.values()].map((claim) => claim.pid))];
	}

	sweep(now = Date.now()): void {
		for (const [nonce, state] of this.nonces)
			if (state.expiresAt <= now) this.nonces.delete(nonce);
		for (const [id, cached] of this.replies)
			if (cached.deadline <= now) this.replies.delete(id);
		const owners = new Map<number, boolean>();
		for (const [key, claim] of this.imports) {
			const isAlive = owners.get(claim.pid) ?? this.ownerIsAlive(claim.pid);
			owners.set(claim.pid, isAlive);
			if (!isAlive) this.imports.delete(key);
		}
	}

	handle(input: unknown, client: string, now = Date.now()): RpcResponse {
		const response: RpcResponse = {
			version: 1,
			id: isRecord(input) && typeof input.id === "string" ? input.id : "",
			epoch: this.epoch,
			ok: false,
		};
		try {
			if (
				!isRecord(input) ||
				input.version !== 1 ||
				input.epoch !== this.epoch ||
				typeof input.id !== "string" ||
				input.id.length > 128 ||
				input.id.length === 0 ||
				!Number.isSafeInteger(input.pid) ||
				(input.pid as number) <= 0 ||
				typeof input.deadline !== "number" ||
				!Number.isFinite(input.deadline) ||
				input.deadline <= now ||
				input.deadline > now + REQUEST_TIMEOUT_MS + 1000 ||
				typeof input.op !== "string" ||
				!isRecord(input.args)
			)
				throw new Error("Invalid, expired, or obsolete coordinator request");

			const request = input as unknown as RpcRequest;
			const cacheKey = `${client}:${request.id}`;
			const fingerprint = createHash("sha256")
				.update(JSON.stringify(request))
				.digest("hex");
			const cached = this.replies.get(cacheKey);
			if (cached) {
				if (cached.fingerprint !== fingerprint)
					throw new Error("Request ID reused for a different operation");
				return cached.response;
			}
			if (this.replies.size >= MAX_REPLIES) {
				this.sweep(now);
				if (this.replies.size >= MAX_REPLIES)
					throw new Error("Coordinator request capacity reached");
			}

			try {
				response.value = this.perform(request, client, now);
				response.ok = true;
			} catch (error) {
				response.error =
					error instanceof Error ? error.message : "Coordinator error";
			}
			this.replies.set(cacheKey, {
				fingerprint,
				deadline: request.deadline,
				response,
			});
		} catch (error) {
			response.error =
				error instanceof Error ? error.message : "Coordinator error";
		}
		return response;
	}

	private claim(key: string): ImportClaim | undefined {
		const claim = this.imports.get(key);
		if (claim && !this.ownerIsAlive(claim.pid)) {
			this.imports.delete(key);
			return undefined;
		}
		return claim;
	}

	private perform(request: RpcRequest, client: string, now: number): unknown {
		const args = request.args as Record<string, unknown>;
		switch (request.op) {
			case "ping":
				return true;
			case "nonce.create": {
				const nonce = text(args.nonce);
				for (const [key, state] of this.nonces)
					if (state.expiresAt <= now) this.nonces.delete(key);
				if (this.nonces.has(nonce)) throw new Error("Nonce already exists");
				if (this.nonces.size >= MAX_NONCES)
					throw new Error("Too many pending authentication requests");
				const expiresAt = now + NONCE_TTL_MS;
				this.nonces.set(nonce, { approved: false, expiresAt });
				return expiresAt;
			}
			case "nonce.approve":
			case "nonce.consume": {
				const nonce = text(args.nonce);
				const state = this.nonces.get(nonce);
				if (!state || state.expiresAt <= now) {
					this.nonces.delete(nonce);
					return request.op === "nonce.approve" ? false : "missing";
				}
				if (request.op === "nonce.approve") {
					state.approved = true;
					return true;
				}
				if (!state.approved) return "pending";
				this.nonces.delete(nonce);
				return "approved";
			}
			case "import.claim": {
				const key = text(args.key);
				const token = text(args.token);
				const state = progress(args.progress);
				if (this.claim(key)) return false;
				if (!this.ownerIsAlive(request.pid))
					throw new Error("Import owner is no longer alive");
				if (this.imports.size >= MAX_IMPORTS)
					throw new Error("Too many active imports");
				this.imports.set(key, {
					token,
					client,
					pid: request.pid,
					progress: state,
				});
				return true;
			}
			case "import.update":
			case "import.release": {
				const key = text(args.key);
				const claim = this.claim(key);
				if (
					!claim ||
					claim.token !== text(args.token) ||
					claim.client !== client ||
					claim.pid !== request.pid
				)
					return false;
				if (request.op === "import.release") this.imports.delete(key);
				else claim.progress = progress(args.progress);
				return true;
			}
			case "import.get":
				return this.claim(text(args.key))?.progress ?? null;
			case "fees.publish": {
				if (!isRecord(args.update)) throw new Error("Invalid fee estimate");
				if (
					!Number.isSafeInteger(args.sequence) ||
					(args.sequence as number) < 1
				)
					throw new Error("Invalid fee estimate sequence");
				const sequence = args.sequence as number;
				if (this.feePublisher) {
					const samePublisher =
						this.feePublisher.client === client &&
						this.feePublisher.pid === request.pid;
					if (samePublisher && sequence <= this.feePublisher.sequence)
						return false;
					if (!samePublisher && this.ownerIsAlive(this.feePublisher.pid))
						throw new Error("Another fee estimator owns the snapshot");
				}
				const update = args.update;
				if (update.ready !== undefined && typeof update.ready !== "boolean")
					throw new Error("Invalid fee readiness");
				const values = update.fees;
				let snapshot: FeeSnapshot | null = null;
				if (update.ready !== false) {
					if (
						!isRecord(values) ||
						!FEE_PERCENTILES.every(
							(key) =>
								typeof values[key] === "number" &&
								Number.isFinite(values[key]) &&
								(values[key] as number) >= 0,
						)
					)
						throw new Error("Incomplete fee estimate");
					snapshot = {
						fees: Object.fromEntries(
							FEE_PERCENTILES.map((key) => [key, values[key]]),
						) as EstimatorFees,
						updatedAt: now,
					};
				}
				this.fees = snapshot;
				this.feePublisher = { client, pid: request.pid, sequence };
				return true;
			}
			case "fees.get":
				return this.fees &&
					this.feePublisher &&
					this.ownerIsAlive(this.feePublisher.pid) &&
					now - this.fees.updatedAt < FEE_TTL_MS
					? this.fees
					: null;
			default:
				throw new Error("Unknown coordinator operation");
		}
	}
}

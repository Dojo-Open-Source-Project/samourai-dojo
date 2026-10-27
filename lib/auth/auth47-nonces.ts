import { randomBytes } from "node:crypto";

export const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_NONCES = 1000;

interface Nonce {
	approved: boolean;
	expiresAt: number;
}

/** Auth47 challenges belong to the single Accounts process. */
export class Auth47Nonces {
	private readonly nonces = new Map<string, Nonce>();

	constructor(private readonly now: () => number = Date.now) {}

	create(): { nonce: string; expiresAt: number } {
		const now = this.now();
		for (const [nonce, state] of this.nonces)
			if (state.expiresAt <= now) this.nonces.delete(nonce);
		if (this.nonces.size >= MAX_NONCES)
			throw new Error("Too many pending authentication requests");
		const nonce = randomBytes(12).toString("hex");
		const expiresAt = now + NONCE_TTL_MS;
		this.nonces.set(nonce, { approved: false, expiresAt });
		return { nonce, expiresAt };
	}

	approve(nonce: string): boolean {
		const state = this.get(nonce);
		if (!state) return false;
		state.approved = true;
		return true;
	}

	consume(nonce: string): "missing" | "pending" | "approved" {
		const state = this.get(nonce);
		if (!state) return "missing";
		if (!state.approved) return "pending";
		this.nonces.delete(nonce);
		return "approved";
	}

	private get(nonce: string): Nonce | undefined {
		const state = this.nonces.get(nonce);
		if (state && state.expiresAt <= this.now()) {
			this.nonces.delete(nonce);
			return undefined;
		}
		return state;
	}
}

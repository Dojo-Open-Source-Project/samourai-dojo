import { randomBytes } from "node:crypto";
import QuickLRU from "quick-lru";

export const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_NONCES = 1000;

interface Nonce {
	approved: boolean;
}

/** Auth47 challenges belong to the single Accounts process. */
export class Auth47Nonces {
	private readonly nonces = new QuickLRU<string, Nonce>({
		maxSize: MAX_NONCES,
		maxAge: NONCE_TTL_MS,
	});

	create(): { nonce: string; expiresAt: number } {
		const nonce = randomBytes(12).toString("hex");
		const expiresAt = Date.now() + NONCE_TTL_MS;
		this.nonces.set(nonce, { approved: false });
		return { nonce, expiresAt };
	}

	approve(nonce: string): boolean {
		const state = this.nonces.peek(nonce);
		if (!state) return false;
		state.approved = true;
		return true;
	}

	consume(nonce: string): "missing" | "pending" | "approved" {
		const state = this.nonces.peek(nonce);
		if (!state) return "missing";
		if (!state.approved) return "pending";
		this.nonces.delete(nonce);
		return "approved";
	}
}

import assert from "node:assert/strict";
import { Context } from "hono";
import type { Pool } from "mariadb";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import authentication from "../../../lib/auth/authentication-manager.js";
import db from "../../../lib/db/mysql-db-wrapper.js";
import errors from "../../../lib/errors.js";
import Logger from "../../../lib/logger.js";

vi.mock("../../../keys/index.js", () => ({
	default: {
		testnet: {
			auth: {
				activeStrategy: "localApiKey",
				mandatory: true,
				strategies: {
					localApiKey: {
						adminKey: "configured-admin",
						apiKeys: ["configured-api"],
					},
				},
				jwt: {
					secret: "test-secret",
					accessToken: { expires: "1h" },
					refreshToken: { expires: "1d" },
				},
			},
		},
	},
}));

beforeEach(() => {
	db.dbConfig = { namedPlaceholders: true };
	vi.spyOn(Logger, "info").mockImplementation(() => {});
	vi.spyOn(Logger, "error").mockImplementation(() => {});
});
afterEach(() => {
	db.pool = null;
	db.dbConfig = null;
	vi.restoreAllMocks();
});

async function authenticate(apiKey: unknown, useQuery = false) {
	const c = new Context<HttpEnv>(
		new Request(
			`http://dojo.test/${useQuery ? `?apikey=${String(apiKey)}` : ""}`,
		),
	);
	c.set("body", useQuery ? {} : { apikey: apiKey });
	const next = vi.fn<() => Promise<void>>().mockResolvedValue();
	await authentication.authenticate(c, next);
	return { user: c.get("user"), next };
}

describe("API-key authentication", () => {
	it.each([
		["configured-admin", "admin"],
		["configured-api", "api"],
	])("accepts %s without a database lookup", async (apiKey, profile) => {
		const execute = vi.fn();
		db.pool = { execute } as unknown as Pool;
		const { user, next } = await authenticate(apiKey);
		assert.deepEqual(user, { authenticated: true, profile });
		assert.deepEqual(next.mock.calls, [[]]);
		assert.equal(execute.mock.calls.length, 0);
	});

	it("authenticates database keys through one prepared lookup", async () => {
		const execute = vi
			.fn()
			.mockResolvedValue([[{ apikey: "database-key" }], []]);
		db.pool = { execute } as unknown as Pool;
		const { user, next } = await authenticate("database-key", true);
		assert.deepEqual(user, { authenticated: true, profile: "api" });
		assert.deepEqual(next.mock.calls, [[]]);
		assert.equal(execute.mock.calls.length, 1);
		assert.deepEqual(execute.mock.calls[0][1], ["database-key"]);
	});

	it("rejects missing, non-string, and unmatched keys", async () => {
		db.pool = {
			execute: vi.fn().mockResolvedValue([[], []]),
		} as unknown as Pool;
		for (const key of [undefined, ["database-key"], "unknown"]) {
			await assert.rejects(
				authenticate(key),
				(error) =>
					error instanceof Error &&
					error.message === errors.auth.INVALID_API_KEY,
			);
		}
	});

	it("propagates a database lookup failure without authenticating", async () => {
		const error = new Error("database unavailable");
		db.pool = { execute: vi.fn().mockRejectedValue(error) } as unknown as Pool;
		await assert.rejects(authenticate("database-key"), (e) => e === error);
	});
});

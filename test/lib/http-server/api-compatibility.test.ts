import { once } from "node:events";
import { Auth47Verifier } from "@dojo-tools/auth47";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import FeesRestApi from "../../../accounts/fees-rest-api.js";
import HeadersRestApi from "../../../accounts/headers-rest-api.js";
import LatestBlockRestApi from "../../../accounts/latest-block-rest-api.js";
import MultiaddrRestApi from "../../../accounts/multiaddr-rest-api.js";
import NotificationsService from "../../../accounts/notifications-service.js";
import SeenRestApi from "../../../accounts/seen-rest-api.js";
import StatusRestApi from "../../../accounts/status-rest-api.js";
import SupportRestApi from "../../../accounts/support-rest-api.js";
import TransactionsRestApi from "../../../accounts/transactions-rest-api.js";
import UnspentRestApi from "../../../accounts/unspent-rest-api.js";
import WalletRestApi from "../../../accounts/wallet-rest-api.js";
import XPubRestApi from "../../../accounts/xpub-rest-api.js";
import AuthRestApi from "../../../lib/auth/auth-rest-api.js";
import rpcHeaders from "../../../lib/bitcoind-rpc/headers.js";
import rpcTxns from "../../../lib/bitcoind-rpc/transactions.js";
import db from "../../../lib/db/mysql-db-wrapper.js";
import errors from "../../../lib/errors.js";
import HttpServer from "../../../lib/http-server/http-server.js";
import Logger from "../../../lib/logger.js";
import pushTxProcessor from "../../../pushtx/pushtx-processor.js";
import PushTxRestApi from "../../../pushtx/pushtx-rest-api.js";
import type Tracker from "../../../tracker/tracker.js";
import TrackerRestApi from "../../../tracker/tracker-rest-api.js";
import { legacyJwt } from "../../fixtures/legacy-jwt.js";

vi.mock("../../../keys/index.js", async () => ({
	default: {
		testnet: (await import("../../fixtures/http-config.js")).httpConfig,
	},
}));
vi.mock("../../../lib/bitcoind-rpc/fees.js", () => ({
	default: {
		refresh: vi.fn(),
		getFees: vi.fn(async () => ({ "2": 12 })),
		getEstimatorFees: vi.fn(async () => ({ "2": 14 })),
	},
}));
vi.mock("../../../lib/bitcoind-rpc/headers.js", () => ({
	default: { getHeader: vi.fn(async () => "01000000") },
}));
vi.mock("../../../lib/bitcoind-rpc/latest-block.js", () => ({
	default: { height: 157798, hash: "block-hash", time: 12345 },
}));
vi.mock("../../../lib/bitcoind-rpc/transactions.js", () => ({
	default: {
		getTransaction: vi.fn(async () => ({ txid: "tx-hash" })),
		getTransactionHex: vi.fn(async () => "01000000"),
		rpcClient: { gettxout: vi.fn(async () => ({ value: 0.01 })) },
	},
}));
vi.mock("../../../lib/db/mysql-db-wrapper.js", () => ({
	default: {
		isApiKeyActive: vi.fn(async () => false),
		getApiKeys: vi.fn(async () => []),
		createApiKey: vi.fn(async () => {}),
		getApiKeyID: vi.fn(async () => 5),
		updateApiKey: vi.fn(async () => {}),
		deleteApiKey: vi.fn(async () => {}),
	},
}));
vi.mock("../../../lib/bitcoin/hd-accounts-service.js", () => ({ default: {} }));
vi.mock("../../../lib/remote-importer/remote-importer.js", () => ({
	default: {},
}));
vi.mock("../../../lib/wallet/wallet-service.js", () => ({ default: {} }));
vi.mock("../../../accounts/status.js", () => ({
	default: {
		getCurrent: vi.fn(async () => ({ uptime: "00:00:42" })),
		sessions: 0,
		clients: 0,
		maxConn: 0,
	},
}));
vi.mock("../../../pushtx/status.js", () => ({
	default: {
		getCurrent: vi.fn(async () => ({ uptime: 42 })),
		getScheduledTransactions: vi.fn(async () => ({ nbTxs: 0, txs: [] })),
	},
}));
vi.mock("../../../pushtx/pushtx-processor.js", () => ({
	default: {
		pushTx: vi.fn(async () => "tx-hash"),
		enforceStrictModeVouts: vi.fn(async () => [] as number[]),
	},
}));
vi.mock("../../../pushtx/transactions-scheduler.js", () => ({
	default: class {
		async schedule() {}
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Logger, "info").mockImplementation(() => {});
	vi.spyOn(Logger, "error").mockImplementation(() => {});
});

function authorization(prf = "admin", type = "access-token") {
	const iat = Math.floor(Date.now() / 1000);
	return `Bearer ${legacyJwt({ iss: "Samourai Wallet backend", type, prf, iat, exp: iat + 600 })}`;
}
function accounts() {
	const http = new HttpServer(0);
	new AuthRestApi(http);
	new XPubRestApi(http);
	new FeesRestApi(http);
	new HeadersRestApi(http);
	new TransactionsRestApi(http);
	new StatusRestApi(http);
	new WalletRestApi(http);
	new MultiaddrRestApi(http);
	new UnspentRestApi(http);
	new SupportRestApi(http);
	new SeenRestApi(http);
	new LatestBlockRestApi(http);
	return http;
}

describe("migrated API contracts", () => {
	it("issues tokens after an approved Auth47 challenge and consumes it once", async () => {
		const http = accounts();
		const challenge = await (await http.app.request("/auth/auth47/uri")).json();
		const { nonce, uri } = challenge.data;
		const signedChallenge = new URL(uri);
		signedChallenge.searchParams.set(
			"r",
			signedChallenge.searchParams.get("c"),
		);
		const pending = await http.app.request(`/auth/auth47/status/${nonce}`);
		expect(await pending.json()).toEqual({});
		const proof = vi
			.spyOn(Auth47Verifier.prototype, "verifyProof")
			.mockReturnValue({
				result: "ok",
				data: { challenge: signedChallenge.toString() },
			} as ReturnType<Auth47Verifier["verifyProof"]>);
		try {
			const approved = await http.app.request("/auth/auth47/authenticate", {
				method: "POST",
				body: JSON.stringify({ nym: "allowed-payment-code" }),
			});
			expect(approved.status, JSON.stringify(await approved.json())).toBe(200);
			const result = await http.app.request(`/auth/auth47/status/${nonce}`);
			expect(await result.json()).toEqual({
				authorizations: {
					access_token: expect.any(String),
					refresh_token: expect.any(String),
				},
			});
			expect(
				(await http.app.request(`/auth/auth47/status/${nonce}`)).status,
			).toBe(401);
		} finally {
			proof.mockRestore();
		}
	});

	it("logs in, refreshes with each supported token source, and keeps access tokens out of refresh verification", async () => {
		const http = accounts();
		const login = await http.app.request("/auth/login", {
			method: "POST",
			body: "apikey=configured-admin",
		});
		expect(login.status).toBe(200);
		const { authorizations: tokens } = await login.json();
		expect(tokens.access_token).toBeTypeOf("string");
		expect(tokens.refresh_token).toBeTypeOf("string");
		expect(
			(
				await http.app.request("/support/apikeys", {
					headers: { Authorization: `Bearer ${tokens.access_token}` },
				})
			).status,
		).toBe(200);
		for (const init of [
			{ body: `rt=${tokens.refresh_token}` },
			{ headers: { Authorization: `Bearer ${tokens.refresh_token}` } },
		]) {
			const refresh = await http.app.request("/auth/refresh", {
				method: "POST",
				...init,
			});
			expect(refresh.status).toBe(200);
			expect(await refresh.json()).toEqual({
				authorizations: { access_token: expect.any(String) },
			});
		}
		expect(
			(
				await http.app.request(`/auth/refresh?rt=${tokens.refresh_token}`, {
					method: "POST",
				})
			).status,
		).toBe(200);
		const wrongType = await http.app.request("/auth/refresh", {
			method: "POST",
			body: `rt=${tokens.refresh_token}`,
			headers: { Authorization: `Bearer ${tokens.access_token}` },
		});
		expect(wrongType.status).toBe(401);
		expect(await wrongType.json()).toEqual({
			status: "error",
			error: errors.auth.INVALID_JWT,
		});
		const invalid = await http.app.request("/auth/login", {
			method: "POST",
			body: "apikey=invalid",
		});
		expect(invalid.status).toBe(401);
		expect(await invalid.json()).toEqual({
			status: "error",
			error: errors.auth.INVALID_API_KEY,
		});
		expect(
			await (await http.app.request("/auth/logout", { method: "POST" })).json(),
		).toEqual({ status: "ok" });
	});

	it.each([
		["GET", "/fees"],
		["POST", "/fees"],
		["GET", "/fees/estimator"],
		["GET", "/header/hash"],
		["GET", "/latest-block"],
		["GET", "/tx/hash"],
		["GET", "/tx/hash/hex"],
		["GET", "/txs"],
		["GET", "/txout/hash/0"],
		["GET", "/status"],
		["GET", "/status/"],
		["GET", "/wallet"],
		["POST", "/wallet"],
		["GET", "/multiaddr"],
		["POST", "/multiaddr"],
		["GET", "/unspent"],
		["POST", "/unspent"],
		["GET", "/xpub/value"],
		["POST", "/xpub"],
		["POST", "/xpub/"],
		["DELETE", "/xpub/value"],
		["POST", "/xpub/value/lock"],
		["GET", "/xpub/value/import/status"],
		["GET", "/seen"],
		["GET", "/support/pairing"],
		["GET", "/support/pairing/explorer"],
		["GET", "/support/services"],
		["GET", "/support/apikeys"],
		["POST", "/support/apikey"],
		["PATCH", "/support/apikey/key"],
		["DELETE", "/support/apikey/key"],
		["GET", "/support/address/address/info"],
		["GET", "/support/address/address/rescan"],
		["GET", "/support/xpub/value/info"],
		["GET", "/support/xpub/value/rescan"],
		["GET", "/support/xpub/value/delete"],
	])(
		"retains %s %s and its authentication requirement",
		async (method, path) => {
			const response = await accounts().app.request(path, { method });
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({
				status: "error",
				error: errors.auth.MISSING_JWT,
			});
		},
	);

	it("preserves account response formats, route parameters, and transaction options", async () => {
		const http = accounts();
		const headers = { Authorization: authorization() };
		expect(await (await http.app.request("/fees", { headers })).json()).toEqual(
			{ "2": 12 },
		);
		expect(
			await (
				await http.app.request("/fees", { method: "POST", headers })
			).json(),
		).toEqual({ "2": 12 });
		expect(
			await (await http.app.request("/latest-block", { headers })).json(),
		).toEqual({ height: 157798, hash: "block-hash", time: 12345 });
		const txid = "a".repeat(64);
		expect(
			await (await http.app.request(`/header/${txid}`, { headers })).text(),
		).toBe("01000000");
		expect(rpcHeaders.getHeader).toHaveBeenCalledWith(txid);
		expect(
			await (
				await http.app.request(`/tx/${txid}?fees=1&rawHex=1`, { headers })
			).text(),
		).toBe(JSON.stringify({ txid: "tx-hash" }, null, 2));
		expect(rpcTxns.getTransaction).toHaveBeenCalledWith(txid, {
			fees: true,
			rawHex: true,
		});
		expect(
			await (await http.app.request(`/tx/${txid}/hex`, { headers })).json(),
		).toEqual({ status: "ok", data: "01000000" });
		expect(
			await (await http.app.request(`/txout/${txid}/2`, { headers })).json(),
		).toEqual({ value: 0.01 });
		expect(rpcTxns.rpcClient.gettxout).toHaveBeenCalledWith({ txid, n: 2 });
		const invalid = await http.app.request("/header/not-a-hash", { headers });
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({
			status: "error",
			error: errors.body.INVDATA,
		});
		expect((await http.app.request("/status/", { headers })).status).toBe(200);
	});

	it("preserves JSON API-key creation, updates with active=false, and admin checks", async () => {
		const http = accounts();
		const headers = {
			Authorization: authorization(),
			"Content-Type": "application/json",
		};
		const expiresAt = "2027-01-01T00:00:00Z";
		expect(
			(
				await http.app.request("/support/apikey", {
					method: "POST",
					headers,
					body: JSON.stringify({ label: "Wallet", expiresAt }),
				})
			).status,
		).toBe(200);
		expect(db.createApiKey).toHaveBeenCalledWith(
			"Wallet",
			expect.any(String),
			new Date(expiresAt),
		);
		expect(
			(
				await http.app.request("/support/apikey/key", {
					method: "PATCH",
					headers,
					body: JSON.stringify({ label: "Wallet", expiresAt, active: false }),
				})
			).status,
		).toBe(200);
		expect(db.updateApiKey).toHaveBeenCalledWith(
			5,
			"Wallet",
			false,
			new Date(expiresAt),
		);
		const forbidden = await http.app.request("/support/apikeys", {
			headers: { Authorization: authorization("api") },
		});
		expect(forbidden.status).toBe(401);
		expect(await forbidden.json()).toEqual({
			status: "error",
			error: errors.auth.INVALID_PRF,
		});
	});

	it("preserves Push TX forms, strict-mode errors, schedule JSON, and status URLs", async () => {
		const http = new HttpServer(0);
		new PushTxRestApi(http);
		const headers = { Authorization: authorization() };
		expect(
			await (
				await http.app.request("/", {
					method: "POST",
					headers,
					body: "tx=01000000&tx=ignored&strict_mode_vouts=0%7C2",
				})
			).json(),
		).toEqual({ status: "ok", data: "tx-hash" });
		expect(pushTxProcessor.pushTx).toHaveBeenCalledWith("01000000");
		expect(pushTxProcessor.enforceStrictModeVouts).toHaveBeenCalledWith(
			"01000000",
			[0, 2],
		);
		vi.mocked(pushTxProcessor.enforceStrictModeVouts).mockResolvedValueOnce([
			2,
		]);
		const violation = await http.app.request("/", {
			method: "POST",
			headers,
			body: "tx=01000000&strict_mode_vouts=2",
		});
		expect(violation.status).toBe(200);
		expect(await violation.json()).toEqual({
			status: "error",
			error: { code: errors.pushtx.VIOLATION_STRICT_MODE_VOUTS, message: [2] },
		});
		expect(
			(
				await http.app.request("/schedule", {
					method: "POST",
					headers,
					body: JSON.stringify({
						script: [{ tx: "01000000", hop: 0, nlocktime: 157798 }],
					}),
				})
			).status,
		).toBe(200);
		for (const path of ["/status", "/status/", "/status/schedule"])
			expect((await http.app.request(path, { headers })).status).toBe(200);
		expect((await http.app.request("/", { headers })).status).toBe(405);
		expect((await http.app.request("/missing", { headers })).status).toBe(404);
		expect((await http.app.request("/status")).status).toBe(401);
	});

	it("preserves tracker block rescan arguments, response, and validation", async () => {
		const http = new HttpServer(0);
		const rescanBlocks = vi.fn(async () => {});
		new TrackerRestApi(http, {
			blockchainProcessor: { rescanBlocks },
		} as unknown as Tracker);
		const headers = { Authorization: authorization() };
		const response = await http.app.request(
			"/support/rescan?fromHeight=12&toHeight=14",
			{ headers },
		);
		expect(await response.json()).toEqual({
			status: "Rescan complete",
			fromHeight: 12,
			toHeight: 14,
		});
		expect(rescanBlocks).toHaveBeenCalledWith(12, 14);
		expect(
			(
				await http.app.request("/support/rescan?fromHeight=14&toHeight=12", {
					headers,
				})
			).status,
		).toBe(400);
		expect(
			(await http.app.request("/support/rescan?fromHeight=12")).status,
		).toBe(401);
	});

	it("awaits JWT verification for WebSocket messages on the same Node server", async () => {
		const http = new HttpServer(0);
		const node = http.start();
		const notifications = new NotificationsService(node);
		let client: WebSocket | undefined;
		try {
			await once(node, "listening");
			const address = node.address();
			if (!address || typeof address === "string")
				throw new Error("Missing listening address");
			client = new WebSocket(`ws://127.0.0.1:${address.port}`);
			await once(client, "open");
			const replies = new Promise<string[]>((resolve) => {
				const messages: string[] = [];
				client.on("message", (message: Buffer) => {
					messages.push(message.toString());
					if (messages.length === 3) resolve(messages);
				});
			});
			client.send(JSON.stringify({ op: "ping", at: authorization().slice(7) }));
			client.send(
				JSON.stringify({
					op: "ping",
					at: authorization("admin", "refresh-token").slice(7),
				}),
			);
			client.send(JSON.stringify({ op: "ping", at: authorization().slice(7) }));
			const messages = await replies;
			expect(messages[0]).toBe('{"op": "pong"}');
			expect(JSON.parse(messages[1])).toMatchObject({
				op: "error",
			});
			expect(messages[2]).toBe('{"op": "pong"}');
		} finally {
			if (client && client.readyState !== WebSocket.CLOSED) {
				const closed = once(client, "close");
				client.close();
				await closed;
			}
			notifications.ws?.close();
			const closed = once(node, "close");
			http.stop();
			await closed;
		}
	});
});

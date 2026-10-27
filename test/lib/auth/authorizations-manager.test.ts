import { createHmac } from "node:crypto";
import { Context } from "hono";
import { decode } from "hono/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import authorizations from "../../../lib/auth/authorizations-manager.js";
import errors from "../../../lib/errors.js";
import HttpServer from "../../../lib/http-server/http-server.js";
import Logger from "../../../lib/logger.js";
import { legacyJwt } from "../../fixtures/legacy-jwt.js";

vi.mock("../../../keys/index.js", async () => ({
	default: {
		testnet: (await import("../../fixtures/http-config.js")).httpConfig,
	},
}));

beforeEach(() => {
	vi.spyOn(Logger, "info").mockImplementation(() => {});
	vi.spyOn(Logger, "error").mockImplementation(() => {});
	authorizations.authActive = true;
	authorizations.isMandatory = true;
	authorizations.accessTokenExpires = 600;
	authorizations.refreshTokenExpires = 7200;
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function payload(type = "access-token") {
	const now = Math.floor(Date.now() / 1000);
	return {
		iss: "Samourai Wallet backend",
		type,
		prf: "admin",
		iat: now,
		exp: now + 600,
	};
}
function context(
	url = "http://dojo.test/",
	body: UnknownRecord = {},
	header?: string,
) {
	const c = new Context<HttpEnv>(
		new Request(url, header ? { headers: { Authorization: header } } : {}),
	);
	c.set("body", body);
	return c;
}

describe("Hono JWT compatibility", () => {
	it("accepts access and refresh tokens in the previous HS256 wire format", async () => {
		const access = legacyJwt(payload());
		expect(await authorizations.isAuthenticated(access)).toMatchObject({
			type: "access-token",
			prf: "admin",
		});
		expect(
			await authorizations._verifyRefreshToken(
				legacyJwt(payload("refresh-token")),
			),
		).toMatchObject({ type: "refresh-token", prf: "admin" });
	});

	it.each([600, "10m", "1 hour", "120", "2 days", "1y"])(
		"preserves configured token lifetime %s and the existing claims",
		async (expires) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-10-27T20:00:00Z"));
			authorizations.accessTokenExpires = expires;
			const token = await authorizations._generateAccessToken({
				profile: "admin",
			});
			const { header, payload: claims } = decode(token);
			const durations: Record<string, number> = {
				"600": 600,
				"10m": 600,
				"1 hour": 3600,
				"120": 0,
				"2 days": 172800,
				"1y": 31557600,
			};
			expect(header).toEqual({ alg: "HS256", typ: "JWT" });
			expect(claims).toEqual({
				iss: "Samourai Wallet backend",
				type: "access-token",
				prf: "admin",
				iat: 1793131200,
				exp: 1793131200 + durations[String(expires)],
			});
			// Independently verify tokens issued by Hono using the original HMAC algorithm.
			const [h, p, sig] = token.split(".");
			expect(sig).toBe(
				createHmac("sha256", "test-secret")
					.update(`${h}.${p}`)
					.digest("base64url"),
			);
		},
	);

	it("does not treat refresh tokens as access tokens or access tokens as refresh tokens", async () => {
		await expect(
			authorizations.isAuthenticated(legacyJwt(payload("refresh-token"))),
		).rejects.toBe(errors.auth.INVALID_JWT);
		await expect(
			authorizations._verifyRefreshToken(legacyJwt(payload())),
		).rejects.toBe(errors.auth.INVALID_JWT);
	});

	it("rejects expired, premature, incorrectly signed, malformed, and wrong-algorithm tokens", async () => {
		const now = Math.floor(Date.now() / 1000);
		const tokens = [
			legacyJwt({ ...payload(), exp: now }),
			legacyJwt({ ...payload(), nbf: now + 100 }),
			legacyJwt({ ...payload(), exp: "tomorrow" }),
			legacyJwt(payload(), "wrong-secret"),
			legacyJwt(payload(), "test-secret", "HS384"),
			"invalid-token",
		];
		for (const token of tokens)
			await expect(authorizations.isAuthenticated(token)).rejects.toBe(
				errors.auth.INVALID_JWT,
			);
		await expect(authorizations.isAuthenticated()).rejects.toBe(
			errors.auth.MISSING_JWT,
		);
	});

	it("retains acceptance of a future iat from clients with clock skew", async () => {
		const claims = { ...payload(), iat: Math.floor(Date.now() / 1000) + 60 };
		expect(await authorizations.isAuthenticated(legacyJwt(claims))).toEqual(
			claims,
		);
	});

	it("retains header, form, and query token sources and their precedence", async () => {
		const access = legacyJwt(payload());
		const refresh = legacyJwt(payload("refresh-token"));
		expect(
			authorizations._extractAccessToken(
				context(`http://dojo.test/?at=${access}`),
			),
		).toBe(access);
		expect(
			authorizations._extractAccessToken(context(undefined, { at: access })),
		).toBe(access);
		expect(
			authorizations._extractAccessToken(
				context(undefined, { at: "invalid" }, `Bearer ${access}`),
			),
		).toBe(access);
		expect(
			authorizations._extractRefreshToken(
				context(`http://dojo.test/?rt=${refresh}`),
			),
		).toBe(refresh);
		expect(
			authorizations._extractRefreshToken(context(undefined, { rt: refresh })),
		).toBe(refresh);
		expect(
			authorizations._extractRefreshToken(
				context(undefined, { rt: refresh }, `Bearer ${access}`),
			),
		).toBe(access);
	});

	it("continues optional authentication and keeps admin endpoints protected", async () => {
		const http = new HttpServer(0);
		http.app.get(
			"/optional",
			authorizations.checkAuthentication.bind(authorizations),
			async (c) => {
				HttpServer.sendOk(c);
			},
		);
		http.app.get(
			"/admin",
			authorizations.checkHasAdminProfile.bind(authorizations),
			async (c) => {
				HttpServer.sendOk(c);
			},
		);
		authorizations.isMandatory = false;
		expect((await http.app.request("/optional")).status).toBe(200);
		expect((await http.app.request("/admin")).status).toBe(401);
		const user = legacyJwt({ ...payload(), prf: "api" });
		const forbidden = await http.app.request("/admin", {
			headers: { Authorization: `Bearer ${user}` },
		});
		expect(forbidden.status).toBe(401);
		expect(await forbidden.json()).toEqual({
			status: "error",
			error: errors.auth.INVALID_PRF,
		});
		authorizations.authActive = false;
		expect((await http.app.request("/admin")).status).toBe(200);
	});
});

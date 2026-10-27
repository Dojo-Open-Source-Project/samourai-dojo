import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import errors from "../../../lib/errors.js";
import HttpServer from "../../../lib/http-server/http-server.js";
import Logger from "../../../lib/logger.js";

vi.mock("../../../keys/index.js", async () => ({
	default: {
		testnet: (await import("../../fixtures/http-config.js")).httpConfig,
	},
}));

let root: string;
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "dojo-static-"));
	await mkdir(join(root, "admin/dmt"), { recursive: true });
	await mkdir(join(root, ".well-known"));
	await writeFile(join(root, "admin/index.html"), "<h1>Dojo admin</h1>");
	await writeFile(join(root, "admin/dmt/index.html"), "<h1>Dashboard</h1>");
	await writeFile(join(root, "admin/help.htm"), "<h1>Help</h1>");
	await writeFile(join(root, "admin/a b.txt"), "0123456789");
	await writeFile(join(root, ".env"), "hidden");
	await writeFile(join(root, ".well-known/dojo.txt"), "public");
});
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
	vi.spyOn(Logger, "info").mockImplementation(() => {});
	vi.spyOn(Logger, "error").mockImplementation(() => {});
});

function server() {
	return new HttpServer(0, "127.0.0.1", root);
}

describe("Hono HTTP compatibility", () => {
	it("preserves response envelopes, raw JSON, headers, and trailing slash behavior", async () => {
		const http = server();
		http.app.get("/ok", async (c) => {
			HttpServer.sendOk(c);
		});
		http.app.get("/data", async (c) => {
			HttpServer.sendOkData(c, { count: 3 });
		});
		http.app.get("/raw", async (c) => {
			HttpServer.sendRawData(c, '{\n  "count": 3\n}');
		});
		for (const path of ["/ok", "/ok/"]) {
			const response = await http.app.request(path);
			expect(await response.json()).toEqual({ status: "ok" });
			expect(response.headers.get("X-Dojo-Version")).toBe("test-version");
			expect(response.headers.get("Content-Type")).toMatch(
				/^application\/json/,
			);
			expect(response.headers.get("Connection")).toBe("close");
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET,HEAD,POST,DELETE",
			);
			expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
				"Content-Type,Authorization,Accept",
			);
			expect(response.headers.get("Cache-Control")).toBe(
				"no-store, no-cache, must-revalidate, proxy-revalidate",
			);
			expect(response.headers.get("Surrogate-Control")).toBe("no-store");
			expect(response.headers.get("Expires")).toBe("0");
			expect(response.headers.get("Strict-Transport-Security")).toBe(
				"max-age=31536000; includeSubDomains",
			);
			expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
			expect(response.headers.get("Content-Security-Policy")).toBe(
				"default-src 'self' data:; base-uri 'self'; font-src 'self' https: data:; frame-ancestors 'self'; img-src 'self' data: http://paynym25chftmsywv4v2r67agbrr62lcxagsf4tymbzpeeucucy2ivad.onion; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' https: 'unsafe-inline'; media-src 'self' data:",
			);
		}
		expect(await (await http.app.request("/data")).json()).toEqual({
			status: "ok",
			data: { count: 3 },
		});
		expect(await (await http.app.request("/raw")).text()).toBe(
			'{\n  "count": 3\n}',
		);
		const head = await http.app.request("/ok", { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(await head.text()).toBe("");
	});

	it("preserves 404, authentication, and general error envelopes", async () => {
		const http = server();
		http.app.get("/auth-error", () => {
			throw new Error(errors.auth.INVALID_JWT);
		});
		http.app.get("/error", () => {
			throw new Error("private internal detail");
		});
		http.app.get("/caught-error", async (c) => {
			HttpServer.sendError(c, new Error("private internal detail"));
		});
		expect(await (await http.app.request("/missing")).json()).toEqual({
			status: "error",
			error: { status: "404 - Not found" },
		});
		const auth = await http.app.request("/auth-error");
		expect(auth.status).toBe(401);
		expect(await auth.json()).toEqual({
			status: "error",
			error: errors.auth.INVALID_JWT,
		});
		const generic = await http.app.request("/error");
		expect(generic.status).toBe(500);
		expect(await generic.json()).toEqual({
			status: "error",
			error: { status: "Server error" },
		});
		const caught = await http.app.request("/caught-error");
		expect(caught.status).toBe(400);
		expect(await caught.json()).toEqual({
			status: "error",
			error: errors.generic.GEN,
		});
	});

	it("parses form and JSON bodies, including missing content types and duplicate fields", async () => {
		const http = server();
		http.app.post("/form", HttpServer.parseForm, async (c) => {
			HttpServer.sendOkDataOnly(c, c.get("body"));
		});
		http.app.post("/json", HttpServer.parseJson, async (c) => {
			HttpServer.sendOkDataOnly(c, c.get("body"));
		});
		const form = await http.app.request("/form", {
			method: "POST",
			body: "active=first&active=last&label=Dojo+wallet&at%5B%5D=literal",
		});
		expect(await form.json()).toEqual({
			active: "last",
			label: "Dojo wallet",
			"at[]": "literal",
		});
		const json = await http.app.request("/json", {
			method: "POST",
			body: '{"active":false}',
		});
		expect(await json.json()).toEqual({ active: false });
		expect(
			await (await http.app.request("/json", { method: "POST" })).json(),
		).toEqual({});
		for (const body of ["{", JSON.stringify({ value: "x".repeat(102400) })]) {
			const invalid = await http.app.request("/json", { method: "POST", body });
			expect(invalid.status).toBe(500);
			expect(await invalid.json()).toEqual({
				status: "error",
				error: { status: "Server error" },
			});
		}
	});

	it.each([
		"/static/admin/",
		"/static/admin",
		"/static/admin/index",
		"/static/admin/index.html",
		"/static/admin/dmt/",
		"/static/admin/dmt",
		"/static/admin/help",
	])("serves existing admin URLs: %s", async (url) => {
		const response = await server().app.request(url);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
		expect(await response.text()).toMatch(/<h1>/);
	});

	it("retains static HEAD, range requests, encoded names, hidden-file rules, and missing-file errors", async () => {
		const http = server();
		const head = await http.app.request("/static/admin/a%20b.txt", {
			method: "HEAD",
		});
		expect(head.status).toBe(200);
		expect(head.headers.get("Content-Length")).toBe("10");
		expect(await head.text()).toBe("");
		const partial = await http.app.request("/static/admin/a%20b.txt", {
			headers: { Range: "bytes=2-5" },
		});
		expect(partial.status).toBe(206);
		expect(partial.headers.get("Content-Range")).toBe("bytes 2-5/10");
		expect(await partial.text()).toBe("2345");
		const invalid = await http.app.request("/static/admin/a%20b.txt", {
			headers: { Range: "bytes=20-" },
		});
		expect(invalid.status).toBe(416);
		expect(invalid.headers.get("Content-Range")).toBe("bytes */10");
		expect((await http.app.request("/static/.env")).status).toBe(404);
		expect((await http.app.request("/static/admin/missing.js")).status).toBe(
			404,
		);
		expect(
			await (await http.app.request("/static/.well-known/dojo.txt")).text(),
		).toBe("public");
	});

	it("starts a Node server with the existing timeout settings", async () => {
		const http = server();
		http.app.get("/ok", async (c) => {
			HttpServer.sendOk(c);
		});
		const node = http.start();
		try {
			await once(node, "listening");
			const address = node.address();
			if (!address || typeof address === "string")
				throw new Error("Missing listening address");
			const response = await fetch(`http://127.0.0.1:${address.port}/ok`);
			expect(await response.json()).toEqual({ status: "ok" });
			expect(node.timeout).toBe(600000);
			expect(node.keepAliveTimeout).toBe(0);
		} finally {
			const closed = once(node, "close");
			http.stop();
			await closed;
		}
	});
});

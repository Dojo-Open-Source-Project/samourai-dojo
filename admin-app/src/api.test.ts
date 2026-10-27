import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	accessToken,
	clearTokens,
	refreshNeeded,
	refreshToken,
	saveTokens,
} from "./auth";

vi.stubGlobal("__DOJO_ADMIN_API_BASE__", "/v2");
const { api, refreshAccessToken } = await import("./api");

const fetchMock = vi.fn<typeof fetch>();
const unauthorized = vi.fn<() => void>();

function response(body: unknown, status = 200) {
	return Response.json(body, { status });
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("sessionStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, String(value)),
		removeItem: (key: string) => storage.delete(key),
	});
	vi.stubGlobal("window", new EventTarget());
	unauthorized.mockReset();
	window.addEventListener("dojo:unauthorized", unauthorized);
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	saveTokens({ access_token: "old-access", refresh_token: "valid-refresh" });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("admin API token refresh", () => {
	it("uses the access token for successful authenticated requests", async () => {
		fetchMock.mockResolvedValue(response({ uptime: 42 }));
		await expect(api.status()).resolves.toEqual({ uptime: 42 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(
			new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization"),
		).toBe("Bearer old-access");
		expect(unauthorized).not.toHaveBeenCalled();
	});

	it("refreshes without the expired access header and retries the original request", async () => {
		sessionStorage.setItem("activeTab", "#link-pushtx");
		const refreshTime = sessionStorage.getItem("refresh_token_ts");
		fetchMock.mockImplementation(async (url, init) => {
			const headers = new Headers(init?.headers);
			if (url === "/v2/auth/refresh") {
				// The server prioritizes Authorization over the rt form field.
				expect(headers.has("Authorization")).toBe(false);
				expect(headers.get("Content-Type")).toBe(
					"application/x-www-form-urlencoded",
				);
				expect(init?.method).toBe("POST");
				expect(new URLSearchParams(String(init?.body)).get("rt")).toBe(
					"valid-refresh",
				);
				return response({ authorizations: { access_token: "new-access" } });
			}
			return headers.get("Authorization") === "Bearer new-access"
				? response({ uptime: 42 })
				: response({ error: "Invalid JSON Web Token" }, 401);
		});

		await expect(api.status()).resolves.toEqual({ uptime: 42 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(accessToken()).toBe("new-access");
		expect(refreshToken()).toBe("valid-refresh");
		expect(sessionStorage.getItem("refresh_token_ts")).toBe(refreshTime);
		expect(sessionStorage.getItem("activeTab")).toBe("#link-pushtx");
		expect(unauthorized).not.toHaveBeenCalled();
	});

	it.each(["Invalid JSON Web Token", "Missing JSON Web Token"])(
		"also refreshes for legacy token errors: %s",
		async (error) => {
			fetchMock
				.mockResolvedValueOnce(response({ error }, 500))
				.mockResolvedValueOnce(
					response({ authorizations: { access_token: "new-access" } }),
				)
				.mockResolvedValueOnce(response({ uptime: 42 }));
			await expect(api.status()).resolves.toEqual({ uptime: 42 });
			expect(unauthorized).not.toHaveBeenCalled();
		},
	);

	it("shares one refresh between concurrent requests and the periodic refresh", async () => {
		const refresh = deferred<Response>();
		const refreshStarted = deferred<void>();
		fetchMock.mockImplementation(async (url, init) => {
			if (url === "/v2/auth/refresh") {
				refreshStarted.resolve();
				return refresh.promise;
			}
			return new Headers(init?.headers).get("Authorization") ===
				"Bearer new-access"
				? response({ uptime: 42 })
				: response({ error: "Invalid JSON Web Token" }, 401);
		});
		const requests = [api.status(), api.pushStatus()];
		await refreshStarted.promise;
		const periodicRefresh = refreshAccessToken();
		refresh.resolve(
			response({ authorizations: { access_token: "new-access" } }),
		);
		await Promise.all([...requests, periodicRefresh]);
		expect(
			fetchMock.mock.calls.filter(([url]) => url === "/v2/auth/refresh"),
		).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(5);
		expect(unauthorized).not.toHaveBeenCalled();
	});

	it("reuses the new token when an old request fails after refresh completes", async () => {
		const delayed = deferred<Response>();
		fetchMock
			.mockImplementationOnce(() => delayed.promise)
			.mockResolvedValueOnce(response({ error: "Invalid JSON Web Token" }, 401))
			.mockResolvedValueOnce(
				response({ authorizations: { access_token: "new-access" } }),
			)
			.mockResolvedValue(response({ uptime: 42 }));
		const oldRequest = api.status();
		await api.pushStatus();
		delayed.resolve(response({ error: "Invalid JSON Web Token" }, 401));
		await oldRequest;
		expect(
			fetchMock.mock.calls.filter(([url]) => url === "/v2/auth/refresh"),
		).toHaveLength(1);
		expect(
			new Headers(fetchMock.mock.calls[4][1]?.headers).get("Authorization"),
		).toBe("Bearer new-access");
	});

	it("preserves a mutation's method and body when retrying", async () => {
		fetchMock
			.mockResolvedValueOnce(response({ error: "Invalid JSON Web Token" }, 401))
			.mockResolvedValueOnce(
				response({ authorizations: { access_token: "new-access" } }),
			)
			.mockResolvedValueOnce(response({}));
		const input = { label: "Wallet", expiresAt: new Date("2027-01-01") };
		await api.createKey(input);
		const [first, , retry] = fetchMock.mock.calls;
		expect(retry[0]).toBe(first[0]);
		expect(retry[1]?.method).toBe("POST");
		expect(retry[1]?.body).toBe(JSON.stringify(input));
		expect(new Headers(retry[1]?.headers).get("Content-Type")).toBe(
			"application/json",
		);
	});

	it("signs out once when the shared refresh token is rejected", async () => {
		fetchMock.mockImplementation(async () =>
			response({ error: "Invalid JSON Web Token" }, 401),
		);
		const results = await Promise.allSettled([api.status(), api.pushStatus()]);
		expect(results.every((result) => result.status === "rejected")).toBe(true);
		expect(accessToken()).toBeNull();
		expect(refreshToken()).toBeNull();
		expect(unauthorized).toHaveBeenCalledTimes(1);
		expect(
			fetchMock.mock.calls.filter(([url]) => url === "/v2/auth/refresh"),
		).toHaveLength(1);
	});

	it("signs out when there is no refresh token", async () => {
		sessionStorage.removeItem("refresh_token");
		fetchMock.mockResolvedValue(
			response({ error: "Invalid JSON Web Token" }, 401),
		);
		await expect(api.status()).rejects.toThrow("Session expired");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(accessToken()).toBeNull();
		expect(unauthorized).toHaveBeenCalledTimes(1);
	});

	it("stops after one retry if the new access token is also rejected", async () => {
		fetchMock
			.mockResolvedValueOnce(response({ error: "Invalid JSON Web Token" }, 401))
			.mockResolvedValueOnce(
				response({ authorizations: { access_token: "new-access" } }),
			)
			.mockResolvedValue(response({ error: "Invalid JSON Web Token" }, 401));
		await expect(api.status()).rejects.toThrow("Invalid JSON Web Token");
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(accessToken()).toBeNull();
		expect(unauthorized).toHaveBeenCalledTimes(1);
	});

	it.each(["network", "server"])(
		"keeps the session and permits another refresh after a temporary %s failure",
		async (failure) => {
			fetchMock.mockResolvedValueOnce(
				response({ error: "Invalid JSON Web Token" }, 401),
			);
			if (failure === "network")
				fetchMock.mockRejectedValueOnce(new TypeError("Network unavailable"));
			else
				fetchMock.mockResolvedValueOnce(
					response({ error: "Unavailable" }, 503),
				);
			await expect(api.status()).rejects.toThrow();
			expect(accessToken()).toBe("old-access");
			expect(refreshToken()).toBe("valid-refresh");
			expect(unauthorized).not.toHaveBeenCalled();
			fetchMock.mockResolvedValueOnce(
				response({ authorizations: { access_token: "new-access" } }),
			);
			await refreshAccessToken();
			expect(accessToken()).toBe("new-access");
		},
	);

	it.each([403, 500])(
		"does not refresh for an unrelated HTTP %s",
		async (status) => {
			fetchMock.mockResolvedValue(
				response({ error: "Request failed" }, status),
			);
			await expect(api.status()).rejects.toThrow("Request failed");
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(accessToken()).toBe("old-access");
			expect(unauthorized).not.toHaveBeenCalled();
		},
	);

	it("does not restore a session when the user logs out during refresh", async () => {
		const refresh = deferred<Response>();
		fetchMock.mockImplementation(() => refresh.promise);
		const pending = refreshAccessToken();
		clearTokens();
		refresh.resolve(
			response({ authorizations: { access_token: "new-access" } }),
		);
		await pending;
		expect(accessToken()).toBeNull();
		expect(refreshToken()).toBeNull();
	});

	it("does not clear a new login when an older refresh fails", async () => {
		const refresh = deferred<Response>();
		fetchMock.mockImplementation(() => refresh.promise);
		const pending = refreshAccessToken();
		saveTokens({
			access_token: "other-access",
			refresh_token: "other-refresh",
		});
		refresh.resolve(response({ error: "Invalid JSON Web Token" }, 401));
		await expect(pending).rejects.toThrow("Invalid JSON Web Token");
		expect(accessToken()).toBe("other-access");
		expect(refreshToken()).toBe("other-refresh");
		expect(unauthorized).not.toHaveBeenCalled();
	});

	it("does not retry an aborted request after a shared refresh", async () => {
		const refresh = deferred<Response>();
		const refreshStarted = deferred<void>();
		fetchMock
			.mockResolvedValueOnce(response({ error: "Invalid JSON Web Token" }, 401))
			.mockImplementationOnce(() => {
				refreshStarted.resolve();
				return refresh.promise;
			});
		const controller = new AbortController();
		const request = api.status(controller.signal);
		await refreshStarted.promise;
		controller.abort();
		refresh.resolve(
			response({ authorizations: { access_token: "new-access" } }),
		);
		await expect(request).rejects.toMatchObject({ name: "AbortError" });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(accessToken()).toBe("new-access");
		expect(unauthorized).not.toHaveBeenCalled();
	});

	it("does not attach the stale access token or refresh when login fails", async () => {
		fetchMock.mockResolvedValue(response({ error: "Invalid API key" }, 401));
		await expect(api.login("invalid-key")).rejects.toThrow("Invalid API key");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(
			new Headers(fetchMock.mock.calls[0][1]?.headers).has("Authorization"),
		).toBe(false);
		expect(unauthorized).not.toHaveBeenCalled();
	});

	it("lets the server decide refresh expiry rather than imposing two hours", () => {
		sessionStorage.setItem("access_token_ts", String(Date.now() - 300_000));
		sessionStorage.setItem("refresh_token_ts", String(Date.now() - 86_400_000));
		expect(refreshNeeded()).toBe("valid-refresh");
	});
});

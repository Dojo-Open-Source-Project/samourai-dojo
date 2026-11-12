import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type VerifyClientCallbackAsync, WebSocket } from "ws";
import NotificationsService from "../../accounts/notifications-service.js";
import status from "../../accounts/status.js";
import authMgr from "../../lib/auth/authorizations-manager.js";
import Logger from "../../lib/logger.js";

vi.mock("../../lib/auth/authorizations-manager.js", () => ({
	default: { authActive: true, isMandatory: true, isAuthenticated: vi.fn() },
}));
vi.mock("../../accounts/api-helper.js", () => ({ default: {} }));
vi.mock("../../lib/db/mysql-db-wrapper.js", () => ({ default: {} }));
vi.mock("../../accounts/status.js", () => ({
	default: { sessions: 0, clients: 0, maxConn: 0 },
}));

type ClientSocket = Parameters<NotificationsService["_handleWSMessage"]>[1];

class Socket extends EventEmitter {
	declare id: number;
	declare subs: string[];
	readyState: number = WebSocket.OPEN;
	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = WebSocket.CLOSING;
	});
	terminate = vi.fn(() => this.finishClose());
	finishClose() {
		if (this.readyState === WebSocket.CLOSED) return;
		this.readyState = WebSocket.CLOSED;
		this.emit("close");
	}
	get client() {
		return this as unknown as ClientSocket;
	}
}

let service: NotificationsService;
const node = createServer();

function admission() {
	const done = vi.fn();
	const verify = service.ws.options.verifyClient as VerifyClientCallbackAsync;
	verify({ origin: "", secure: false, req: {} as IncomingMessage }, done);
	return done.mock.calls[0];
}

function connect() {
	expect(admission()[0]).toBe(true);
	const socket = new Socket();
	service.ws.clients.add(socket.client);
	socket.once("close", () => service.ws.clients.delete(socket.client));
	service.ws.emit("connection", socket.client);
	return socket;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetAllMocks();
	vi.spyOn(Logger, "info").mockImplementation(() => {});
	vi.spyOn(Logger, "error").mockImplementation(() => {});
	authMgr.authActive = true;
	authMgr.isMandatory = true;
	vi.mocked(authMgr.isAuthenticated).mockResolvedValue({
		type: "access-token",
	});
	status.clients = 0;
	status.sessions = 0;
	status.maxConn = 0;
	service = new NotificationsService(node);
});

afterEach(() => {
	for (const client of service.ws.clients) client.terminate();
	service.ws.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("WebSocket connection admission", () => {
	it("closes an idle unauthenticated connection and forcibly releases an uncooperative transport", async () => {
		const socket = connect();
		expect(status.clients).toBe(1);
		await vi.advanceTimersByTimeAsync(
			NotificationsService.AUTHENTICATION_TIMEOUT_MS - 1,
		);
		expect(socket.close).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(socket.close).toHaveBeenCalledWith(1008, expect.any(String));
		expect(status.clients).toBe(0);
		expect(Object.keys(service.conn)).toHaveLength(0);
		expect(service.ws.clients.size).toBe(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(socket.terminate).toHaveBeenCalledOnce();
		expect(service.ws.clients.size).toBe(0);
		expect(status.clients).toBe(0);
	});

	it("clears the deadline after successful authentication and preserves authenticated subscriptions", async () => {
		const socket = connect();
		// Leave time for the first message to arrive over a slow Tor connection.
		await vi.advanceTimersByTimeAsync(45_000);
		await service._handleWSMessage(
			JSON.stringify({ op: "blocks_sub", at: "valid" }),
			socket.client,
		);
		await vi.advanceTimersByTimeAsync(
			NotificationsService.AUTHENTICATION_TIMEOUT_MS + 1000,
		);
		expect(socket.close).not.toHaveBeenCalled();
		service.notifyBlock({ height: 1, hash: "block-hash" });
		expect(socket.send).toHaveBeenCalled();
		expect(service.subs.block).toEqual([socket.id]);
		expect(status.clients).toBe(1);
	});

	it("closes on failed authentication, removes subscriptions, and ignores subsequent queued messages", async () => {
		const socket = connect();
		await service._handleWSMessage(
			'{"op":"blocks_sub","at":"valid"}',
			socket.client,
		);
		vi.mocked(authMgr.isAuthenticated).mockRejectedValueOnce("Invalid token");
		await service._handleWSMessage(
			'{"op":"ping","at":"invalid"}',
			socket.client,
		);
		expect(socket.send).toHaveBeenCalledWith(
			JSON.stringify({ op: "error", msg: "Invalid token" }),
		);
		expect(socket.close).toHaveBeenCalledOnce();
		expect(service.subs.block).toBeUndefined();
		expect(status.clients).toBe(0);
		await service._handleWSMessage(
			'{"op":"blocks_sub","at":"valid"}',
			socket.client,
		);
		expect(authMgr.isAuthenticated).toHaveBeenCalledTimes(2);
		expect(service.subs.block).toBeUndefined();
		socket.finishClose();
		expect(status.clients).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not revive a connection whose authentication finishes after its deadline", async () => {
		const verification = Promise.withResolvers<{ type: string }>();
		vi.mocked(authMgr.isAuthenticated).mockReturnValueOnce(
			verification.promise,
		);
		const socket = connect();
		const message = service._handleWSMessage(
			'{"op":"blocks_sub","at":"valid"}',
			socket.client,
		);
		await vi.advanceTimersByTimeAsync(
			NotificationsService.AUTHENTICATION_TIMEOUT_MS,
		);
		verification.resolve({ type: "access-token" });
		await message;
		expect(service.subs.block).toBeUndefined();
		expect(status.clients).toBe(0);
	});

	it("bounds pending connections and restores capacity after authentication or disconnect", async () => {
		const sockets = Array.from(
			{ length: NotificationsService.MAX_PENDING_CONNECTIONS },
			() => connect(),
		);
		expect(admission()).toEqual([false, 503]);
		await service._handleWSMessage(
			'{"op":"ping","at":"valid"}',
			sockets[0].client,
		);
		expect(admission()[0]).toBe(true);
		connect();
		expect(admission()).toEqual([false, 503]);
		sockets[1].finishClose();
		expect(admission()[0]).toBe(true);
		connect();
		expect(status.clients).toBe(
			NotificationsService.MAX_PENDING_CONNECTIONS + 1,
		);
	});

	it("bounds total transports including closing sockets and restores capacity only after transport closure", async () => {
		const sockets: Socket[] = [];
		for (let i = 0; i < NotificationsService.MAX_CONNECTIONS; i++) {
			const socket = connect();
			await service._handleWSMessage(
				'{"op":"ping","at":"valid"}',
				socket.client,
			);
			sockets.push(socket);
		}
		expect(admission()).toEqual([false, 503]);
		service._closeWSConnection(sockets[0].client, true);
		expect(admission()).toEqual([false, 503]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(admission()[0]).toBe(true);
		connect();
		expect(status.clients).toBe(NotificationsService.MAX_CONNECTIONS);
	});

	it.each(["disabled", "optional"])(
		"does not require authentication when it is %s",
		async (mode) => {
			if (mode === "disabled") authMgr.authActive = false;
			else authMgr.isMandatory = false;
			const socket = connect();
			await service._handleWSMessage('{"op":"ping"}', socket.client);
			expect(socket.send).toHaveBeenCalledWith('{"op": "pong"}');
			expect(authMgr.isAuthenticated).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(
				NotificationsService.AUTHENTICATION_TIMEOUT_MS + 1000,
			);
			expect(socket.close).not.toHaveBeenCalled();
		},
	);
});

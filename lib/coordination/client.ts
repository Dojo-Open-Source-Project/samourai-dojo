import { randomUUID } from "node:crypto";
import { Dealer } from "zeromq";
import { coordinatorConnection } from "./connection.js";
import {
	type CoordinatorConnection,
	isRecord,
	MAX_MESSAGE_BYTES,
	type Operation,
	type Operations,
	REQUEST_TIMEOUT_MS,
	type RpcRequest,
} from "./protocol.js";

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
	retry: ReturnType<typeof setInterval>;
	timeout: ReturnType<typeof setTimeout>;
}

export class CoordinatorError extends Error {}

export class CoordinatorClient {
	private readonly socket: Dealer;
	private readonly pending = new Map<string, PendingRequest>();
	private closed = false;

	constructor(private readonly connection: CoordinatorConnection) {
		this.socket = new Dealer({
			routingId: randomUUID(),
			linger: 0,
			sendTimeout: 0,
			sendHighWaterMark: 1000,
			receiveHighWaterMark: 1000,
			maxMessageSize: MAX_MESSAGE_BYTES,
		});
		this.socket.connect(connection.endpoint);
		void this.receive();
	}

	request<K extends Operation>(
		op: K,
		args: Operations[K]["args"],
	): Promise<Operations[K]["result"]> {
		if (this.closed)
			return Promise.reject(
				new CoordinatorError("Coordinator client is closed"),
			);
		if (this.pending.size >= 256)
			return Promise.reject(
				new CoordinatorError("Too many pending coordinator requests"),
			);
		const request: RpcRequest = {
			version: 1,
			id: randomUUID(),
			epoch: this.connection.epoch,
			pid: process.pid,
			deadline: Date.now() + REQUEST_TIMEOUT_MS,
			op,
			args,
		};
		const message = JSON.stringify(request);
		if (Buffer.byteLength(message) > MAX_MESSAGE_BYTES)
			return Promise.reject(
				new CoordinatorError("Coordinator request is too large"),
			);

		return new Promise<Operations[K]["result"]>((resolve, reject) => {
			const send = () => {
				if (this.closed || !this.pending.has(request.id)) return;
				// sendTimeout=0 keeps concurrent sends bounded; failures retry with this ID.
				try {
					void this.socket.send(message).catch(() => {});
				} catch {
					// A synchronous socket failure follows the same retry deadline.
				}
			};
			const retry = setInterval(send, 250);
			const timeout = setTimeout(() => {
				this.finish(
					request.id,
					new CoordinatorError("Coordinator request timed out"),
				);
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(request.id, {
				resolve: (value) => resolve(value as Operations[K]["result"]),
				reject,
				retry,
				timeout,
			});
			send();
		});
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const id of this.pending.keys())
			this.finish(id, new CoordinatorError("Coordinator client closed"));
		this.socket.close();
	}

	private finish(id: string, error?: Error, value?: unknown): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timeout);
		clearInterval(pending.retry);
		if (error) pending.reject(error);
		else pending.resolve(value);
	}

	private async receive(): Promise<void> {
		try {
			for await (const [message] of this.socket) {
				const response: unknown = JSON.parse(message.toString());
				if (
					!isRecord(response) ||
					response.version !== 1 ||
					typeof response.id !== "string" ||
					typeof response.ok !== "boolean" ||
					response.epoch !== this.connection.epoch
				)
					throw new CoordinatorError(
						"Invalid coordinator response or coordinator restarted",
					);
				this.finish(
					response.id,
					response.ok
						? undefined
						: new CoordinatorError(String(response.error)),
					response.value,
				);
			}
			if (!this.closed) this.close();
		} catch (error) {
			if (!this.closed) {
				for (const id of this.pending.keys())
					this.finish(
						id,
						new CoordinatorError("Coordinator connection failed", {
							cause: error,
						}),
					);
				this.close();
			}
		}
	}
}

let client: CoordinatorClient | undefined;

export const coordinator = {
	request<K extends Operation>(
		op: K,
		args: Operations[K]["args"],
	): Promise<Operations[K]["result"]> {
		try {
			client ??= new CoordinatorClient(coordinatorConnection());
			return client.request(op, args);
		} catch (error) {
			return Promise.reject(
				error instanceof CoordinatorError
					? error
					: new CoordinatorError(
							"Coordinator unavailable; start the Dojo supervisor first",
							{ cause: error },
						),
			);
		}
	},
	close(): void {
		client?.close();
		client = undefined;
	},
};

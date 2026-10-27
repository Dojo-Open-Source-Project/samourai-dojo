import { Router } from "zeromq";
import { coordinatorConnection } from "./connection.js";
import { isRecord, MAX_MESSAGE_BYTES } from "./protocol.js";
import { CoordinatorState } from "./state.js";

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

async function main(): Promise<void> {
	const connection = coordinatorConnection();
	process.umask(0o077);
	const socket = new Router({
		linger: 0,
		sendTimeout: 0,
		sendHighWaterMark: 1000,
		receiveHighWaterMark: 1000,
		maxMessageSize: MAX_MESSAGE_BYTES,
	});
	const state = new CoordinatorState(connection.epoch, isProcessAlive);
	let draining = false;
	let lastOwners = "[]";
	let ownerSequence = 0;
	process.on("message", (message: unknown) => {
		if (
			isRecord(message) &&
			message.type === "drain" &&
			message.epoch === connection.epoch
		) {
			draining = true;
			process.send?.({ type: "drained", epoch: connection.epoch });
		}
	});

	async function registerOwners(): Promise<void> {
		const pids = state.ownerPids().sort((a, b) => a - b);
		const snapshot = JSON.stringify(pids);
		if (snapshot === lastOwners) return;
		if (!process.connected || !process.send)
			throw new Error("Import claims require a connected Dojo supervisor");
		const id = ++ownerSequence;
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timeout);
				process.removeListener("message", acknowledged);
			};
			const acknowledged = (message: unknown) => {
				if (
					isRecord(message) &&
					message.type === "owners-ack" &&
					message.epoch === connection.epoch &&
					message.id === id
				) {
					cleanup();
					resolve();
				}
			};
			const timeout = setTimeout(() => {
				cleanup();
				reject(new Error("Supervisor did not register import owners"));
			}, 1000);
			process.on("message", acknowledged);
			process.send?.(
				{ type: "owners", epoch: connection.epoch, id, pids },
				(error) => {
					if (error) {
						cleanup();
						reject(error);
					}
				},
			);
		});
		lastOwners = snapshot;
	}
	await socket.bind(connection.endpoint);
	const sweep = setInterval(() => state.sweep(), 1000);
	const close = () => {
		clearInterval(sweep);
		if (!socket.closed) socket.close();
	};
	process.once("SIGTERM", close);
	process.once("SIGINT", close);
	process.once("disconnect", close);
	process.send?.({ type: "ready", epoch: connection.epoch });
	console.log("Coordinator: ready");

	try {
		for await (const [identity, message] of socket) {
			if (!identity || !message) continue;
			let input: unknown;
			try {
				input = JSON.parse(message.toString());
			} catch {
				continue;
			}
			// Mutation and duplicate detection finish before the first await.
			const response =
				draining && isRecord(input) && input.op !== "import.release"
					? {
							version: 1,
							id: typeof input.id === "string" ? input.id : "",
							epoch: connection.epoch,
							ok: false,
							error: "Coordinator is shutting down",
						}
					: state.handle(input, identity.toString("hex"));
			if (
				isRecord(input) &&
				(input.op === "import.claim" || input.op === "import.release")
			)
				// A claim is not acknowledged until its owner is tracked by the launcher.
				await registerOwners();
			try {
				await socket.send([identity, JSON.stringify(response)]);
			} catch {
				// The request can be retried with its original ID until its deadline.
			}
		}
	} catch (error) {
		if (!socket.closed) throw error;
	} finally {
		clearInterval(sweep);
		if (!socket.closed) socket.close();
	}
}

main().catch((error: unknown) => {
	console.error("Coordinator: fatal error", error);
	process.exit(1);
});

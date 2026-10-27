import { type ChildProcess, fork, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CoordinatorClient } from "./client.js";
import { coordinatorDirectory } from "./connection.js";
import { type CoordinatorConnection, isRecord } from "./protocol.js";

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

function waitForExit(child: ChildProcess, timeout: number): Promise<void> {
	if (!child.pid || child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve();
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			child.removeListener("exit", finish);
			resolve();
		};
		const timer = setTimeout(finish, timeout);
		child.once("exit", finish);
	});
}

async function workerPids(pm2Home: string): Promise<number[]> {
	const directory = path.join(pm2Home, "pids");
	const files = await readdir(directory).catch(() => [] as string[]);
	const values = await Promise.all(
		files
			.filter((name) => name.endsWith(".pid"))
			.map((name) =>
				readFile(path.join(directory, name), "utf8").catch(() => ""),
			),
	);
	return values
		.map(Number)
		.filter((pid) => Number.isSafeInteger(pid) && pid > 1);
}

async function stopWorkers(
	runtime: ChildProcess | undefined,
	pm2Home: string,
	owners: Set<number>,
): Promise<void> {
	if (!runtime && owners.size === 0) return;
	const deadline = Date.now() + 7000;
	const pids = new Set(await workerPids(pm2Home));
	const external = new Set([...owners].filter((pid) => !pids.has(pid)));
	for (const pid of external) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// The registered maintenance process has already exited.
		}
	}
	runtime?.kill("SIGTERM");
	// pm2-runtime handles SIGTERM by stopping all its applications.
	if (runtime) await waitForExit(runtime, Math.max(0, deadline - Date.now()));
	while ([...external].some(alive) && Date.now() < deadline)
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	for (const pid of await workerPids(pm2Home)) pids.add(pid);
	if (runtime && runtime.exitCode === null && runtime.signalCode === null)
		runtime.kill("SIGKILL");
	// PM2 forks detached process groups, so killing only its parent is insufficient.
	for (const pid of pids) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// The worker has already exited.
			}
		}
	}
	for (const pid of new Set([...external, ...owners])) {
		if (pids.has(pid)) continue;
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// The registered maintenance process has already exited.
		}
	}
	if (runtime) await waitForExit(runtime, 1000);
}

async function main(): Promise<number> {
	const directory = coordinatorDirectory();
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSync(directory, 0o700);
	const lockPath = path.join(directory, "supervisor.lock");
	const token = randomUUID();
	let previousOwners: number[] = [];
	if (existsSync(lockPath)) {
		const old: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
		if (
			!isRecord(old) ||
			typeof old.pid !== "number" ||
			(old.pid !== process.pid && alive(old.pid))
		)
			throw new Error("A Dojo supervisor is already running for this network");
		if (isRecord(old) && Array.isArray(old.owners))
			previousOwners = old.owners.filter(
				(pid): pid is number => Number.isSafeInteger(pid) && pid > 1,
			);
		unlinkSync(lockPath);
	}
	const lock = openSync(lockPath, "wx", 0o600);
	try {
		writeFileSync(
			lock,
			JSON.stringify({ pid: process.pid, token, owners: previousOwners }),
		);
	} finally {
		closeSync(lock);
	}

	let session: string | undefined;
	let owner: ChildProcess | undefined;
	let runtime: ChildProcess | undefined;
	let health: CoordinatorClient | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let stopCode: number | undefined;
	let resolveStop: (code: number) => void;
	const stopped = new Promise<number>((resolve) => {
		resolveStop = resolve;
	});
	const stop = (code: number) => {
		if (stopCode !== undefined) return;
		stopCode = code;
		resolveStop(code);
	};
	const onSignal = () => stop(0);
	process.once("SIGTERM", onSignal);
	process.once("SIGINT", onSignal);
	const descriptor = path.join(directory, "connection.json");
	const pm2Home = path.join(directory, "pm2");
	let connection: CoordinatorConnection | undefined;
	const owners = new Set<number>();

	try {
		const previousPids = [...previousOwners, ...(await workerPids(pm2Home))];
		const managerPidFile = path.join(pm2Home, "pm2.pid");
		if (existsSync(managerPidFile)) {
			const pid = Number(readFileSync(managerPidFile, "utf8"));
			if (Number.isSafeInteger(pid) && pid > 1) previousPids.push(pid);
		}
		if (previousPids.some((pid) => pid !== process.pid && alive(pid)))
			throw new Error(
				"Old Dojo workers are still running; stop them before restarting the supervisor",
			);
		if (stopCode !== undefined) return stopCode;

		session = mkdtempSync(path.join(directory, "session-"));
		const socketPath = path.join(session, "rpc.sock");
		if (Buffer.byteLength(socketPath) > 100)
			throw new Error(
				"Coordinator socket path is too long; set DOJO_COORDINATOR_DIR to a shorter path",
			);
		connection = { endpoint: `ipc://${socketPath}`, epoch: randomUUID() };
		const env = {
			...process.env,
			DOJO_COORDINATOR_ENDPOINT: connection.endpoint,
			DOJO_COORDINATOR_EPOCH: connection.epoch,
			PM2_HOME: pm2Home,
		};
		owner = fork(fileURLToPath(new URL("./server.js", import.meta.url)), [], {
			env,
			stdio: ["ignore", "inherit", "inherit", "ipc"],
		});
		owner.on("message", (message: unknown) => {
			if (
				!isRecord(message) ||
				message.type !== "owners" ||
				message.epoch !== connection?.epoch ||
				typeof message.id !== "number" ||
				!Array.isArray(message.pids) ||
				!message.pids.every(
					(pid) =>
						Number.isSafeInteger(pid) &&
						pid > 1 &&
						pid !== process.pid &&
						pid !== owner?.pid,
				)
			)
				return;
			owners.clear();
			for (const pid of message.pids) owners.add(pid as number);
			try {
				const nextLock = path.join(session, "supervisor.next");
				writeFileSync(
					nextLock,
					JSON.stringify({ pid: process.pid, token, owners: [...owners] }),
					{ mode: 0o600 },
				);
				renameSync(nextLock, lockPath);
				owner?.send({
					type: "owners-ack",
					epoch: connection.epoch,
					id: message.id,
				});
			} catch (error) {
				console.error("Supervisor: cannot register import owners", error);
				stop(1);
			}
		});
		owner.once("error", (error) => {
			console.error("Supervisor: coordinator failed", error);
			stop(1);
		});
		owner.once("exit", () => {
			if (stopCode === undefined)
				console.error(
					"Supervisor: coordinator exited; stopping all application workers",
				);
			stop(1);
		});

		let readyTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				new Promise<void>((resolve, reject) => {
					readyTimer = setTimeout(
						() => reject(new Error("Coordinator did not become ready")),
						10000,
					);
					owner?.on("message", (message: unknown) => {
						if (
							isRecord(message) &&
							message.type === "ready" &&
							message.epoch === connection?.epoch
						)
							resolve();
					});
				}),
				stopped.then(() => {
					throw new Error("Supervisor stopped during startup");
				}),
			]);
		} finally {
			clearTimeout(readyTimer);
		}
		health = new CoordinatorClient(connection);
		await health.request("ping", {});
		if (stopCode !== undefined) return stopCode;

		const temporary = path.join(session, "connection.json");
		writeFileSync(temporary, JSON.stringify(connection), { mode: 0o600 });
		renameSync(temporary, descriptor);
		const config =
			process.argv[2] ??
			path.join(process.env.APP_DIR ?? process.cwd(), "pm2.config.cjs");
		runtime = spawn("pm2-runtime", ["--raw", config], {
			env,
			stdio: "inherit",
		});
		runtime.once("error", (error) => {
			console.error("Supervisor: PM2 failed", error);
			stop(1);
		});
		runtime.once("exit", (code, signal) => stop(signal ? 1 : (code ?? 1)));

		let checking = false;
		heartbeat = setInterval(() => {
			if (checking || stopCode !== undefined) return;
			checking = true;
			void health
				?.request("ping", {})
				.catch((error) => {
					if (stopCode === undefined) {
						console.error("Supervisor: coordinator is unresponsive", error);
						stop(1);
					}
				})
				.finally(() => {
					checking = false;
				});
		}, 1000);
		return await stopped;
	} catch (error) {
		if (stopCode === undefined) {
			console.error("Supervisor: startup failed", error);
			stop(1);
		}
		return stopCode ?? 1;
	} finally {
		clearInterval(heartbeat);
		health?.close();
		// Stop accepting new work before collecting the complete set of claim owners.
		if (owner?.connected && connection) {
			await new Promise<void>((resolve) => {
				const drained = (message: unknown) => {
					if (
						isRecord(message) &&
						message.type === "drained" &&
						message.epoch === connection.epoch
					)
						finish();
				};
				const finish = () => {
					clearTimeout(timeout);
					owner?.removeListener("message", drained);
					resolve();
				};
				const timeout = setTimeout(() => {
					owner?.kill("SIGKILL");
					finish();
				}, 1000);
				owner?.on("message", drained);
				owner?.send({ type: "drain", epoch: connection.epoch }, (error) => {
					if (error) {
						owner?.kill("SIGKILL");
						finish();
					}
				});
			});
		}
		// Keep the state owner alive until application workers have stopped.
		await stopWorkers(runtime, pm2Home, owners);
		if (owner) {
			owner.kill("SIGTERM");
			if (owner.connected) owner.disconnect();
			await waitForExit(owner, 1000);
			if (owner.exitCode === null && owner.signalCode === null)
				owner.kill("SIGKILL");
			await waitForExit(owner, 1000);
		}
		if (existsSync(descriptor)) {
			const current: unknown = JSON.parse(readFileSync(descriptor, "utf8"));
			if (isRecord(current) && current.epoch === connection?.epoch)
				unlinkSync(descriptor);
		}
		if (session) rmSync(session, { recursive: true, force: true });
		// Retain owner metadata so the next launcher can check for surviving processes.
		process.removeListener("SIGTERM", onSignal);
		process.removeListener("SIGINT", onSignal);
	}
}

void main().then(
	(code) => process.exit(code),
	(error: unknown) => {
		console.error("Supervisor: fatal error", error);
		process.exit(1);
	},
);

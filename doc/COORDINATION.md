# Application coordination

Dojo uses a single in-memory coordinator for Auth47 nonces, import ownership and
progress, and fee-estimator snapshots. Application processes communicate with it
through ZeroMQ DEALER/ROUTER request/reply over a private Unix socket. PM2 only
supervises application processes; application code does not load the PM2 SDK.

The Docker restart script launches `dist/lib/coordination/supervisor.js`. The
supervisor starts the coordinator, waits for readiness, and then launches the
existing PM2 configuration. It monitors coordinator exit and responsiveness.
Coordinator failure stops the application workers and exits with a failure code,
allowing Docker's existing restart policy to start the entire group again.
The coordinator is deliberately not a separately restarting PM2 application.

## State and recovery

- Auth47 nonces expire ten minutes after creation. Approval does not extend their
  lifetime. Consuming an approved nonce deletes it before replying, so independent
  API workers cannot mint tokens from the same nonce.
- Import claims cover xpubs and loose addresses. Each claim has an owner process,
  a client identity, and an unguessable ownership token. Only that owner can
  update or release it. A rescan cannot forcibly clear another active import.
  The launcher registers claim owners before the coordinator acknowledges a claim,
  including independently launched maintenance processes. These owners stop with
  the worker group. A worker exits if claim ownership cannot be resolved or released
  safely.
  The coordinator reclaims a crashed worker's claims after confirming its process
  is gone. Claims do not expire merely because a worker is slow or paused.
- Fee snapshots are read on demand, including immediately after a reader starts.
  Snapshots expire after sixty seconds, and a not-ready estimator update
  invalidates the previous snapshot. Publisher sequence numbers prevent a delayed
  retry from replacing a newer update.
- Requests have IDs and five-second deadlines. Retries keep the same ID and
  payload; the coordinator caches their replies until the deadline. Reusing an
  ID for different work or sending a request from an earlier coordinator session
  is rejected. Socket queues, pending requests, and state maps are bounded.

All coordination state is ephemeral. Restarting the group invalidates pending
login challenges, discards import progress, and waits for fresh fee estimates.
Interrupted imports can be retried after startup. Existing wallet/database data
is unaffected. Coordination does not use MySQL.

## Local launches and maintenance scripts

Start the compiled supervisor with a PM2 ecosystem configuration as its first
argument. It requires `pm2-runtime` on PATH. Docker supplies both automatically.
Starting the ecosystem file directly bypasses coordinator lifecycle management.

`COMMON_BTC_NETWORK` selects `mainnet` or `testnet` and must match for the
supervisor and any separately launched maintenance scripts. Each network has its
own runtime directory under `~/.dojo/coordination`; `DOJO_COORDINATOR_DIR` can
override that base directory. Keep this path short enough for Unix socket limits.

The supervisor publishes an owner-readable `connection.json` containing the
current socket address and session identity. Maintenance scripts running as the
same user discover this file automatically. The file does not preserve state.
The supervised workers receive the same connection through their environment.
PM2's own state lives in the network directory's `pm2` subdirectory.

The supervisor refuses to start a fresh coordinator while earlier PM2 workers
or registered import owners are still alive, including after an abrupt supervisor
failure outside Docker. The lock file records only process ownership metadata;
application coordination state remains in memory. This metadata file is retained
on exit so an interrupted cleanup cannot hide surviving import owners.

Never restart just the coordinator while old application workers remain running.
Use the supervisor or restart the container so active import workers stop before
a fresh coordinator accepts claims.

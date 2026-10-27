# Application coordination

PM2 supervises Dojo's processes directly. The Docker restart script runs
`pm2-runtime --raw` with the ecosystem configuration. Application code does not
load the PM2 SDK, and there is no separate coordination process.

## Imports

Xpub restores, rescans, loose-address imports, and import-status reads run in the
single Accounts process. The remote importer keeps their guards and progress in
memory. It checks and claims each guard synchronously before asynchronous work
starts. Overlapping xpub imports are rejected, overlapping loose addresses are
skipped, and each import releases its own guards in `finally`.

Progress reads return the current local state. Restarting Accounts clears its
guards and progress, and interrupted imports can be retried. These guards cover
one Accounts process; independently running import processes do not share them.

## Fee estimates

Both estimator-fee consumers run in Accounts: the estimator-fees endpoint and
wallet responses. The shared fees module owns one `FeeEstimator`, configured with
`useWorker: true` so calculations run in the library's internal worker thread.
There is no separate Estimator process or ZeroMQ channel for fee estimates.

The module caches the latest ready fee object directly from the estimator's
`data` events. Estimates arrive periodically, normally every twenty seconds.

The cache starts empty. Until the first ready estimate arrives, the estimator-fees
endpoint returns unavailable. After that, the cache keeps its value until another
estimate arrives or Accounts restarts. It has no expiry or invalidation. Not-ready
estimator updates leave the previous fees untouched. There are no request/reply
messages, acknowledgements, sequence numbers, or snapshot requests. Accounts stops
the estimator worker when it shuts down.

## Auth47

Auth47 nonce creation, approval, and status checks also run in Accounts. Its Auth
API keeps up to 1,000 challenges locally. Nonces expire ten minutes after creation;
approval does not extend their lifetime. A successful status check synchronously
deletes the approved nonce before issuing tokens, so it authorizes only one request.
Restarting Accounts invalidates its pending login challenges.

# Installation

# Endpoint documentation

Endpoint documentation is split into separate files and presented here under specific servers.


## Accounts Server
Keeps track of HD account balances, represented by `xpub` extended public keys.

### Endpoints
* [POST auth/login](./POST_auth_login.md)
* [GET multiaddr](./GET_multiaddr.md)
* [GET unspent](./GET_unspent.md)
* [GET xpub](./GET_xpub.md)
* [POST xpub](./POST_xpub.md)
* [POST xpub/lock](./POST_xpub_lock.md)
* [GET tx](./GET_tx.md)
* [GET tx_hex](./GET_tx_hex.md)
* [GET txs](./GET_txs.md)
* [GET header](./GET_header.md)
* [GET fees](./GET_fees.md)
* [GET fees_estimator](./GET_fees_estimator.md)
* [GET seen](./GET_seen.md)
* [GET txout](./GET_txout.md)
* [GET latest_block](./GET_latest_block.md)


## PushTX Server
A simple server that relays transactions from the wallet to the full node.

### Endpoints
* [POST pushtx](./POST_pushtx.md)


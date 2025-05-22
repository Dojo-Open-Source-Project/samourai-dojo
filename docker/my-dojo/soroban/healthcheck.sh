#!/bin/bash
set -e

if [ "$SOROBAN_ANNOUNCE" == "on" ]; then
    RPC_API_URL="http://$(cat "$SOROBAN_ONION_FILE").onion/rpc"
    SOROBAN_ANNOUNCE_KEY=$([[ "$COMMON_BTC_NETWORK" == "testnet" ]] && echo "$SOROBAN_ANNOUNCE_KEY_TEST" || echo "$SOROBAN_ANNOUNCE_KEY_MAIN")
    curl -f -s --retry 1 --max-time 15 --retry-delay 15 --retry-max-time 30 -X POST -H 'Content-Type: application/json' -d "{ \"jsonrpc\": \"2.0\", \"id\": 42, \"method\":\"directory.List\", \"params\": [{ \"Name\": \"$SOROBAN_ANNOUNCE_KEY\"}] }" --proxy socks5h://localhost:9050 "$RPC_API_URL" || exit 1
fi

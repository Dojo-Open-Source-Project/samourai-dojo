#!/bin/bash
set -e

if [ "$SOROBAN_ANNOUNCE" == "on" ]; then
    RPC_API_URL="http://$(cat $SOROBAN_ONION_FILE).onion/rpc"
    curl -f -s --retry 1 --max-time 15 --retry-delay 15 --retry-max-time 30 -X POST -H 'Content-Type: application/json' -d '{ "jsonrpc": "2.0", "id": 42, "method":"directory.List", "params": [{ "Name": "soroban.cluster.testnet.nodes"}] }' --proxy socks5h://localhost:9050 $RPC_API_URL || bash -c 'kill -s 15 -1 && (sleep 10; kill -s 9 -1)'
fi

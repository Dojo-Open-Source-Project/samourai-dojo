#!/bin/bash

echo "Running ban script"

FOR_BAN=$(bitcoin-cli \
  -rpcconnect="$NET_DOJO_BITCOIND_IPV4" \
  --rpcport="$BITCOIND_RPC_PORT" \
  --rpcuser="$BITCOIND_RPC_USER" \
  --rpcpassword="$BITCOIND_RPC_PASSWORD" \
  getpeerinfo | \
  jq --arg NET_DOJO_TOR_IPV4 "$NET_DOJO_TOR_IPV4" --raw-output \
  '.[] | select(.subver | contains("Knots")) | .addr | select(contains($NET_DOJO_TOR_IPV4) | not) | split("((?::))(?:[0-9]+)$"; null) | .[0]' \
)

echo "Addresses for ban: $FOR_BAN"

for address in $FOR_BAN;
do
  bitcoin-cli \
    -rpcconnect=bitcoind \
    --rpcport="$BITCOIND_RPC_PORT" \
    --rpcuser="$BITCOIND_RPC_USER" \
    --rpcpassword="$BITCOIND_RPC_PASSWORD" \
    setban "$address" "add" 1893456000 true
done

echo "Ban script finished"

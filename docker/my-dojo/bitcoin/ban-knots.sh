#!/bin/bash

echo "Running ban script"

# Get all Knots nodes
ALL_KNOTS=$(bitcoin-cli \
  -rpcconnect="$NET_DOJO_BITCOIND_IPV4" \
  --rpcport="$BITCOIND_RPC_PORT" \
  --rpcuser="$BITCOIND_RPC_USER" \
  --rpcpassword="$BITCOIND_RPC_PASSWORD" \
  getpeerinfo | \
  jq --raw-output \
  '.[] | select(.subver | contains("Knots")) | {addr: .addr, id: .id}'
)

# Iterate over all Knots nodes
echo "$ALL_KNOTS" | jq -c '.' | while read -r node; do
  addr=$(echo "$node" | jq -r '.addr')
  id=$(echo "$node" | jq -r '.id')
  base_addr=$(echo "$addr" | grep -oP '^[^:]+')

  if [[ "$addr" == *"$NET_DOJO_TOR_IPV4"* ]]; then
    echo "Disconnecting node with addr: $addr"
    bitcoin-cli \
      -rpcconnect="$NET_DOJO_BITCOIND_IPV4" \
      --rpcport="$BITCOIND_RPC_PORT" \
      --rpcuser="$BITCOIND_RPC_USER" \
      --rpcpassword="$BITCOIND_RPC_PASSWORD" \
      disconnectnode "" "$id"
  else
    echo "Banning node with addr: $addr"
    bitcoin-cli \
      -rpcconnect="$NET_DOJO_BITCOIND_IPV4" \
      --rpcport="$BITCOIND_RPC_PORT" \
      --rpcuser="$BITCOIND_RPC_USER" \
      --rpcpassword="$BITCOIND_RPC_PASSWORD" \
      setban "$base_addr" "add" 1893456000 true
  fi
done

echo "Ban script finished"

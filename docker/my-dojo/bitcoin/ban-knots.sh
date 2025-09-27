#!/bin/bash

echo "Running ban script"

# Get all Knots nodes (by user agent or service flag 26)
ALL_KNOTS=$(bitcoin-cli \
  -rpcconnect="$NET_DOJO_BITCOIND_IPV4" \
  --rpcport="$BITCOIND_RPC_PORT" \
  --rpcuser="$BITCOIND_RPC_USER" \
  --rpcpassword="$BITCOIND_RPC_PASSWORD" \
  getpeerinfo | \
  jq --raw-output \
  '.[] | 
  select((.subver | contains("Knots")) or ((.services // 0) | . / 67108864 | floor | . % 2 == 1)) | 
  {
    addr: .addr, 
    id: .id, 
    subver: .subver,
    detected_by: (if (.subver | contains("Knots")) then "user-agent" else "service-flag-26" end)
  }'
)

# Iterate over all Knots nodes
echo "$ALL_KNOTS" | jq -c '.' | while read -r node; do
  addr=$(echo "$node" | jq -r '.addr')
  id=$(echo "$node" | jq -r '.id')
  subver=$(echo "$node" | jq -r '.subver')
  detected_by=$(echo "$node" | jq -r '.detected_by')
  base_addr=$(echo "$addr" | grep -oP '^[^:]+')

  if [[ "$addr" == *"$NET_DOJO_TOR_IPV4"* ]]; then
    echo "Disconnecting Knots node: $addr ($subver) [detected by: $detected_by]"
    bitcoin-cli \
      -rpcconnect="$NET_DOJO_BITCOIND_IPV4" \
      --rpcport="$BITCOIND_RPC_PORT" \
      --rpcuser="$BITCOIND_RPC_USER" \
      --rpcpassword="$BITCOIND_RPC_PASSWORD" \
      disconnectnode "" "$id"
  else
    echo "Banning Knots node: $addr ($subver) [detected by: $detected_by]"
    bitcoin-cli \
      -rpcconnect="$NET_DOJO_BITCOIND_IPV4" \
      --rpcport="$BITCOIND_RPC_PORT" \
      --rpcuser="$BITCOIND_RPC_USER" \
      --rpcpassword="$BITCOIND_RPC_PASSWORD" \
      setban "$base_addr" "add" 1893456000 true
  fi
done

echo "Ban script finished"

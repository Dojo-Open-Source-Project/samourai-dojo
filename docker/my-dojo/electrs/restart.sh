#!/bin/bash
set -e

cat > "electrs.toml" <<EOF
auth = "${BITCOIND_RPC_USER}:${BITCOIND_RPC_PASSWORD}"
server_banner = "Welcome to your Samourai Dojo Electrs Server!"
EOF

electrs_options=(
  --log-filters="INFO"
  --index-batch-size="$INDEXER_BATCH_SIZE"
  --db-dir="$ELECTRS_HOME/db"
  --electrum-rpc-addr="$INDEXER_IP:$INDEXER_RPC_PORT"
  --daemon-p2p-addr="$BITCOIND_IP:8333"
  --daemon-rpc-addr="$BITCOIND_IP:$BITCOIND_RPC_PORT"
  --index-lookup-limit="$INDEXER_TXID_LIMIT"
)

if [ "$COMMON_BTC_NETWORK" == "testnet" ]; then
  electrs_options+=(--network="testnet4")
else
  electrs_options+=(--network="bitcoin")
fi

exec electrs "${electrs_options[@]}"

#!/bin/bash
set -e

# Function to check if certificate exists and is valid
check_cert_validity() {
  # Check if files exist
  if [ ! -e "$SSL_CERTFILE" ] || [ ! -e "$SSL_KEYFILE" ]; then
    return 1
  fi

  # Check if certificate is expired
  if openssl x509 -checkend 0 -noout -in "$SSL_CERTFILE" > /dev/null 2>&1; then
    # Certificate is still valid
    return 0
  else
    # Certificate is expired
    rm -f "$SSL_CERTFILE" "$SSL_KEYFILE"
    return 1
  fi
}


if ! check_cert_validity; then
  openssl req -newkey rsa:4096 -sha256 -nodes -x509 -days 365 -subj "/O=Fulcrum/CN=fulcrum-server/C=US" -keyout "$SSL_KEYFILE" -out "$SSL_CERTFILE"
fi

fulcrum_options=(
  --datadir "$INDEXER_HOME/.fulcrum/db"
  --bitcoind "$BITCOIND_IP:$BITCOIND_RPC_PORT"
  --rpcuser "$BITCOIND_RPC_USER"
  --rpcpassword "$BITCOIND_RPC_PASSWORD"
  --cert "$SSL_CERTFILE"
  --key "$SSL_KEYFILE"
)

cd "$INDEXER_FILES"
exec ./Fulcrum "${fulcrum_options[@]}" /etc/fulcrum.conf

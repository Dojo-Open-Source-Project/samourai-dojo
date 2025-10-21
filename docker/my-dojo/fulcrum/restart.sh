#!/bin/bash
set -e

# Constants
CERT_EXPIRY_DAYS=365
RSA_KEY_SIZE=4096
CERT_SUBJECT="/O=Fulcrum/CN=fulcrum-server/C=US"

# Checks if certificate files exist in the filesystem
cert_files_exist() {
  [ -e "$SSL_CERTFILE" ] && [ -e "$SSL_KEYFILE" ]
}

# Validates if the certificate has not expired
is_cert_not_expired() {
  openssl x509 -checkend 0 -noout -in "$SSL_CERTFILE" >/dev/null 2>&1
}

# Removes invalid or expired certificate files
remove_cert_files() {
  rm -f "$SSL_CERTFILE" "$SSL_KEYFILE"
}

# Generates a new self-signed SSL certificate
generate_new_certificate() {
  openssl req \
    -newkey "rsa:$RSA_KEY_SIZE" \
    -sha256 \
    -nodes \
    -x509 \
    -days "$CERT_EXPIRY_DAYS" \
    -subj "$CERT_SUBJECT" \
    -keyout "$SSL_KEYFILE" \
    -out "$SSL_CERTFILE"
}

# Checks if certificate exists and is valid
check_cert_validity() {
  if ! cert_files_exist; then
    return 1
  fi

  if is_cert_not_expired; then
    return 0
  else
    remove_cert_files
    return 1
  fi
}

# Main execution
if ! check_cert_validity; then
  generate_new_certificate
fi

fulcrum_options=(
  --datadir "$INDEXER_HOME/.fulcrum/db"
  --bitcoind "$BITCOIND_IP:$BITCOIND_RPC_PORT"
  --rpcuser "$BITCOIND_RPC_USER"
  --rpcpassword "$BITCOIND_RPC_PASSWORD"
  --cert "$SSL_CERTFILE"
  --key "$SSL_KEYFILE"
  --db-upgrade
)

cd "$INDEXER_FILES"
exec ./Fulcrum "${fulcrum_options[@]}" /etc/fulcrum.conf

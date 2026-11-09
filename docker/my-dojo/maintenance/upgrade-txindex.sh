#!/bin/bash

# Sourced by dojo.sh; use the existing Compose configuration and Docker volume.
upgrade_txindex() (
  set -e

  if [ "$#" -ne 0 ]; then
    echo "Usage: ./dojo.sh upgrade-txindex" >&2
    return 1
  fi

  if [ "$BITCOIND_INSTALL" != "on" ]; then
    echo "Command not supported: your Dojo is using an external bitcoind." >&2
    return 1
  fi

  case "$COMMON_BTC_NETWORK" in
    mainnet ) index_dir=/home/bitcoin/.bitcoin/indexes/txindex ;;
    testnet ) index_dir=/home/bitcoin/.bitcoin/testnet4/indexes/txindex ;;
    * )
      echo "Unsupported Bitcoin network: $COMMON_BTC_NETWORK" >&2
      return 1
      ;;
  esac

  # Use the installed container's exact image, even if an image tag has changed.
  image=$(docker inspect --format '{{.Image}}' bitcoind)
  core_version=$(docker run --rm --network none --entrypoint bitcoind "$image" --version)
  core_major=$(printf '%s\n' "$core_version" | sed -n 's/^Bitcoin Core version v\([0-9][0-9]*\)\..*/\1/p')
  if [ -z "$core_major" ] || [ "$core_major" -lt 32 ]; then
    echo "Upgrade Dojo's Bitcoin Core to 32.1 or newer before rebuilding txindex." >&2
    return 1
  fi

  echo "Stopping Dojo to rebuild txindex for $COMMON_BTC_NETWORK."
  echo "Rebuilding may take several hours. Historical transaction lookups will be unavailable until it finishes."
  yamlFiles=$(select_yaml_files)
  # An unlimited shutdown timeout lets Core flush its databases without SIGKILL.
  $docker_compose $yamlFiles stop --timeout -1

  state=$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' bitcoind)
  if [ "$state" != "exited 0" ]; then
    echo "Bitcoin Core did not shut down cleanly; txindex has not been removed." >&2
    echo "Start Dojo, resolve the shutdown problem, then retry this command." >&2
    return 1
  fi

  # No network or node process runs in this container. Delete only txindex,
  # as the bitcoin user, using the stopped container's existing data volume.
  if ! docker run --rm --network none --volumes-from bitcoind --user bitcoin \
    --entrypoint /bin/sh "$image" -eu -c '
      index_dir=$1
      if [ -L "$index_dir" ] || [ -L "$(dirname "$index_dir")" ]; then
        echo "Refusing to remove a symlinked transaction index." >&2
        exit 1
      fi
      if [ ! -d "$index_dir" ]; then
        echo "No existing txindex found; no index was removed." >&2
        exit 1
      fi
      rm -rf -- "$index_dir"
    ' sh "$index_dir"; then
    echo "Unable to remove txindex. Dojo remains stopped; inspect the error before running ./dojo.sh start." >&2
    return 1
  fi

  echo "Removed txindex. Starting Dojo so Bitcoin Core can rebuild it."
  docker_up --remove-orphans
  echo "Rebuild started. Check progress with: ./dojo.sh bitcoin-cli getindexinfo txindex"
  echo 'Wait for "synced": true before relying on historical transaction lookups.'
)

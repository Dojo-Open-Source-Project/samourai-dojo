#!/bin/bash
set -e

# Prevent excessive memory usage
export MALLOC_ARENA_MAX=1

# Generate RPC auth payload
BITCOIND_RPC_AUTH=$(./rpcauth.py $BITCOIND_RPC_USER $BITCOIND_RPC_PASSWORD)

echo "## Start bitcoind #############################"

bitcoind_options=(
  -datadir=/home/bitcoin/.bitcoin
  -printtoconsole=1
  -dbcache=$BITCOIND_DB_CACHE
  -disablewallet=1
  -dns=$BITCOIND_DNS
  -dnsseed=$BITCOIND_DNSSEED
  -uacomment="Samourai Dojo $DOJO_VERSION_TAG"
  -maxconnections=$BITCOIND_MAX_CONNECTIONS
  -maxmempool=$BITCOIND_MAX_MEMPOOL
  -mempoolexpiry=$BITCOIND_MEMPOOL_EXPIRY
  -minrelaytxfee=$BITCOIND_MIN_RELAY_TX_FEE
  -port=8333
  -proxy="${NET_DOJO_TOR_IPV4}:${TOR_SOCKS_PORT}"
  -rpcallowip=0.0.0.0/0
  -rpcbind=$NET_DOJO_BITCOIND_IPV4
  -rpcport=28256
  -rpcthreads=$BITCOIND_RPC_THREADS
  -rpcworkqueue=$BITCOIND_RPC_WORK_QUEUE
  -rpcauth=$BITCOIND_RPC_AUTH
  -server=1
  -txindex=1
  -zmqpubhashblock=tcp://0.0.0.0:9502
  -zmqpubrawtx=tcp://0.0.0.0:9501
  -mempoolfullrbf=0
)

if [ "$BITCOIND_PERSIST_MEMPOOL" == "on" ]; then
  bitcoind_options+=(-persistmempool=1)
fi

if [ "$BITCOIND_LISTEN_MODE" == "on" ]; then
  bitcoind_options+=(-listen=1)
  bitcoind_options+=(-bind="$NET_DOJO_BITCOIND_IPV4:8334=onion")
  bitcoind_options+=(-externalip=$(cat /var/lib/tor/hsv3bitcoind/hostname))
fi

if [ "$BITCOIND_RPC_EXTERNAL" == "on" ]; then
  bitcoind_options+=(-zmqpubhashtx=tcp://0.0.0.0:9500)
  bitcoind_options+=(-zmqpubrawblock=tcp://0.0.0.0:9503)
fi

if [ "$BITCOIND_BLOOM_FILTERS" == "on" ]; then
  bitcoind_options+=(-peerbloomfilters=1)
fi

if [ "$BITCOIND_BLOCKS_DIR" != "" ]; then
  bitcoind_options+=(-blocksdir="/home/bitcoin/blocks")
fi

if [ "$COMMON_BTC_NETWORK" == "testnet" ]; then
  bitcoind_options+=(-testnet4)
fi

if [ "$BITCOIND_CRON_JOBS" == "on" ]; then
  declare -p | grep -E 'NET_DOJO_BITCOIND_IPV4|BITCOIND_RPC_PORT|BITCOIND_RPC_USER|BITCOIND_RPC_PASSWORD' > "$HOME/container.env"
  service cron start
fi

exec bitcoind "${bitcoind_options[@]}"

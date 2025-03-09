#!/bin/bash
set -e

soroban_options=(
  --log "$SOROBAN_LOG_LEVEL"
  --hostname "$NET_DOJO_SOROBAN_IPV4"
  --port $SOROBAN_PORT
  --p2pListenPort $SOROBAN_P2P_LISTEN_PORT
  --p2pLowWater $SOROBAN_P2P_LOWWATER
  --p2pHighWater $SOROBAN_P2P_HIGHWATER
  --p2pPeerstoreFile "$SOROBAN_P2P_PEERSTORE_FILE"
  --gossipD $SOROBAN_GOSSIP_D
  --gossipDlo $SOROBAN_GOSSIP_DLO
  --gossipDhi $SOROBAN_GOSSIP_DHI
  --gossipDout $SOROBAN_GOSSIP_DOUT
  --gossipDscore $SOROBAN_GOSSIP_DSCORE
  --gossipDlazy $SOROBAN_GOSSIP_DLAZY
  --gossipPrunePeers $SOROBAN_GOSSIP_PRUNE_PEERS
  --gossipLimit $SOROBAN_GOSSIP_LIMIT
  --ipcChildProcessCount $SOROBAN_IPC_CHILD_COUNT
  --ipcNatsPort $SOROBAN_IPC_NATS_PORT
)

if [ "$COMMON_BTC_NETWORK" == "testnet" ]; then
  soroban_options+=(--p2pBootstrap "$SOROBAN_P2P_BOOTSTRAP_TEST")
  soroban_options+=(--domain "$SOROBAN_DOMAIN_TEST")
  soroban_options+=(--p2pRoom "$SOROBAN_P2P_ROOM_TEST")
else
  soroban_options+=(--p2pBootstrap "$SOROBAN_P2P_BOOTSTRAP_MAIN")
  soroban_options+=(--domain "$SOROBAN_DOMAIN_MAIN")
  soroban_options+=(--p2pRoom "$SOROBAN_P2P_ROOM_MAIN")
fi

if [ "$SOROBAN_ANNOUNCE" == "on" ]; then
  if [ "$COMMON_BTC_NETWORK" == "testnet" ]; then
    soroban_options+=(--announce "$SOROBAN_ANNOUNCE_KEY_TEST")
  else
    soroban_options+=(--announce "$SOROBAN_ANNOUNCE_KEY_MAIN")
  fi
  # Announced onion address will be different
  # from onion addeess used by the users of this dojo
  soroban_options+=(--withTor)
else
  soroban_options+=(--announce "")
fi

# All options without an associated value should be last in the list
if [ "$SOROBAN_DHT_SERVER_MODE" == "on" ]; then
  soroban_options+=(--p2pDHTServerMode)
fi

# Clean /tmp directory
rm -rf /tmp/*

touch /home/soroban/tor.log

# Start Tor in background
tor 2>&1 | tee /home/soroban/tor.log &

# Wait for Tor to bootstrap completely
while ! grep -q "Bootstrapped 100% (done)" /home/soroban/tor.log; do
  sleep 1
done

echo "Tor initialization complete!"

# Start Soroban server
exec soroban-server "${soroban_options[@]}"

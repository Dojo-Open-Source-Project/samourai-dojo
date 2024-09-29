#!/bin/bash
set -e

# Set permissions for bitcoind
echo "## Set permissions on /var/lib/tor dir ###"
chmod 750 /var/lib/tor

echo "## Start tor #############################"

tor_options=(
  --SocksPort "$NET_DOJO_TOR_IPV4:$TOR_SOCKS_PORT"
  --SocksPolicy "accept 172.28.0.0/16"
  --SocksPolicy "reject *"
  --DataDirectory /var/lib/tor/.tor
  --DataDirectoryGroupReadable 1
  --HiddenServiceDir /var/lib/tor/hsv3dojo
  --HiddenServiceVersion 3
  --HiddenServicePort "80 $NET_DMZ_NGINX_IPV4:80"
  --HiddenServiceDirGroupReadable 1
  --CookieAuthentication 0
  --ControlPort 9051
)

if [ "$BITCOIND_INSTALL" == "on" ]; then
  if [ "$BITCOIND_LISTEN_MODE" == "on" ]; then
    tor_options+=(--HiddenServiceDir /var/lib/tor/hsv3bitcoind)
    tor_options+=(--HiddenServiceVersion 3)
    tor_options+=(--HiddenServicePort "8333 $NET_DOJO_BITCOIND_IPV4:8333")
    tor_options+=(--HiddenServiceDirGroupReadable 1)
  fi
fi

if [ "$EXPLORER_INSTALL" == "on" ]; then
  tor_options+=(--HiddenServiceDir /var/lib/tor/hsv3explorer)
  tor_options+=(--HiddenServiceVersion 3)
  tor_options+=(--HiddenServicePort "80 $NET_DMZ_NGINX_IPV4:9080")
  tor_options+=(--HiddenServiceDirGroupReadable 1)
fi

if [ "$TOR_USE_BRIDGES" == "on" ]; then
  tor_options+=(--UseBridges 1)
  if [ "$TOR_BRIDGE_TYPE" == "obfs4" ]; then
    tor_options+=(--ClientTransportPlugin "obfs4 exec $OBFS_PROXY")
  fi
  if [ "$TOR_BRIDGE_TYPE" == "snowflake" ]; then
    tor_options+=(--ClientTransportPlugin "snowflake exec $SNOWFLAKE_PROXY")
  fi

  tor_options+=(--Bridge "$TOR_BRIDGE_1")
  if [ "$TOR_BRIDGE_2" != "" ]; then
    tor_options+=(--Bridge "$TOR_BRIDGE_2")
  fi
  if [ "$TOR_BRIDGE_3" != "" ]; then
    tor_options+=(--Bridge "$TOR_BRIDGE_3")
  fi
fi

if [ "$INDEXER_INSTALL" == "on" ]; then
  if [ "$INDEXER_TYPE" == "fulcrum" ]; then
    tor_options+=(--HiddenServiceDir /var/lib/tor/hsv3fulcrum)
    tor_options+=(--HiddenServiceVersion 3)
    tor_options+=(--HiddenServicePort "50001 $NET_DOJO_INDEXER_IPV4:50001")
    tor_options+=(--HiddenServiceDirGroupReadable 1)
  fi
fi

test -d /var/lib/tor/hsv3dojo && chmod 750 /var/lib/tor/hsv3dojo

exec tor "${tor_options[@]}"

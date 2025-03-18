FROM    debian:bullseye-slim AS torbuilder

ENV     TOR_URL             https://dist.torproject.org
ENV     TOR_MIRROR_URL      https://tor.eff.org/dist
ENV     TOR_VERSION         0.4.8.14
ENV     TOR_GPG_KS_URI      hkps://keyserver.ubuntu.com:443
ENV     TOR_GPG_KEYS        0xEB5A896A28988BF5 0xC218525819F78451 0x21194EBB165733EA 0x6AFEE6D49E92B601 B74417EDDF22AC9F9E90F49142E86A2A11F48D36 514102454D0A87DB0767A1EBBE6A0531C18A9179

# Install Tor
RUN     set -ex && \
        apt-get update && \
        apt-get install -y git libevent-dev zlib1g-dev libssl-dev gcc make automake ca-certificates autoconf musl-dev coreutils gpg wget python3 && \
        mkdir -p /usr/local/src/ && \
        cd /usr/local/src && \
        res=0; \
        wget -qO "tor-$TOR_VERSION.tar.gz" "$TOR_URL/tor-$TOR_VERSION.tar.gz" || res=$?; \
        if [ $res -gt 0 ]; then \
          wget -qO "tor-$TOR_VERSION.tar.gz" "$TOR_MIRROR_URL/tor-$TOR_VERSION.tar.gz"; \
        fi && \
        res=0; \
        wget -qO "tor-$TOR_VERSION.tar.gz.sha256sum" "$TOR_URL/tor-$TOR_VERSION.tar.gz.sha256sum" || res=$?; \
        if [ $res -gt 0 ]; then \
          wget -qO "tor-$TOR_VERSION.tar.gz.sha256sum" "$TOR_MIRROR_URL/tor-$TOR_VERSION.tar.gz.sha256sum"; \
        fi && \
        res=0; \
        wget -qO "tor-$TOR_VERSION.tar.gz.sha256sum.asc" "$TOR_URL/tor-$TOR_VERSION.tar.gz.sha256sum.asc" || res=$?; \
        if [ $res -gt 0 ]; then \
          wget -qO "tor-$TOR_VERSION.tar.gz.sha256sum.asc" "$TOR_MIRROR_URL/tor-$TOR_VERSION.tar.gz.sha256sum.asc"; \
        fi && \
        gpg --batch --keyserver "$TOR_GPG_KS_URI" --recv-keys $TOR_GPG_KEYS && \
        gpg --verify "tor-$TOR_VERSION.tar.gz.sha256sum.asc" && \
        sha256sum --ignore-missing --check "tor-$TOR_VERSION.tar.gz.sha256sum" && \
        tar -xzvf "tor-$TOR_VERSION.tar.gz" -C /usr/local/src && \
        cd "/usr/local/src/tor-$TOR_VERSION" && \
        ./configure \
            --disable-asciidoc \
            --sysconfdir=/etc \
            --disable-unittests && \
        make && make install

FROM    golang:1.23-bullseye AS obfs4builder

ENV     OBFS4_URL           https://github.com/Yawning/obfs4.git
ENV     OBFS4_VERSION       0.0.14

RUN     set -ex && \
        apt-get update && \
        apt-get install -y git

# Build OBFS4 proxy
RUN     git clone "$OBFS4_URL" /usr/local/src/obfs4proxy && \
        cd /usr/local/src/obfs4proxy && \
        git checkout "tags/obfs4proxy-$OBFS4_VERSION" && \
        go build -o obfs4proxy/obfs4proxy ./obfs4proxy && \
        cp ./obfs4proxy/obfs4proxy /usr/local/bin

FROM    golang:1.23-bullseye AS snowflakebuilder

ENV     SNOWFLAKE_URL       https://gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/snowflake.git
ENV     SNOWFLAKE_VERSION   2.10.1

RUN     set -ex && \
        apt-get update && \
        apt-get install -y git

# Build Snowflake proxy
RUN     git clone "$SNOWFLAKE_URL" /usr/local/src/snowflake && \
        cd /usr/local/src/snowflake && \
        git checkout "tags/v$SNOWFLAKE_VERSION" && \
        cd client && \
        go get && \
        go build -o snowflake-client && \
        cp ./snowflake-client /usr/local/bin

FROM    debian:bullseye-slim

ENV     TOR_HOME        /var/lib/tor
ENV     TOR_BIN         /usr/local/bin/tor
ENV     TOR_CONF        /etc/tor
ENV     TOR_MAN         /usr/local/share/man
ENV     OBFS_PROXY      /usr/local/bin/obfs4proxy
ENV     SNOWFLAKE_PROXY /usr/local/bin/snowflake-client

ARG     TOR_LINUX_UID
ARG     TOR_LINUX_GID

COPY    --from=torbuilder $TOR_BIN $TOR_BIN
COPY    --from=torbuilder $TOR_CONF $TOR_CONF
COPY    --from=torbuilder $TOR_MAN $TOR_MAN
COPY    --from=obfs4builder $OBFS_PROXY $OBFS_PROXY
COPY    --from=snowflakebuilder $SNOWFLAKE_PROXY $SNOWFLAKE_PROXY

RUN     set -ex && \
        apt-get update && \
        apt-get install -y libevent-dev netcat-openbsd && \
        apt-get clean && \
        rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Create group & user tor
RUN     addgroup --system -gid ${TOR_LINUX_GID} tor && \
        adduser --system --ingroup tor -uid ${TOR_LINUX_UID} tor

# Create /etc/tor directory
RUN     mkdir -p /etc/tor/ && \
        chown -Rv tor:tor /etc/tor

# Create .tor subdirectory of TOR_HOME
RUN     mkdir -p "$TOR_HOME/.tor" && \
        chown -Rv tor:tor "$TOR_HOME" && \
        chmod -R 750 "$TOR_HOME"

# Copy restart script
COPY    --chown=tor:tor --chmod=754 ./restart.sh /restart.sh

# Expose socks port
EXPOSE  ${TOR_SOCKS_PORT}

# Switch to user tor
USER    tor

FROM    debian:bullseye-slim AS tor-builder

# Install prerequisites
RUN     set -ex && \
        apt-get update && \
        apt-get install -y libevent-dev zlib1g-dev libssl-dev gcc make automake ca-certificates autoconf musl-dev coreutils gpg wget

# Install Tor
ENV     WHIRLPOOL_TOR_URL             https://dist.torproject.org
ENV     WHIRLPOOL_TOR_MIRROR_URL      https://tor.eff.org/dist
ENV     WHIRLPOOL_TOR_VERSION         0.4.8.10
ENV     WHIRLPOOL_TOR_GPG_KS_URI      hkps://keyserver.ubuntu.com:443
ENV     WHIRLPOOL_TOR_GPG_KEYS        0xEB5A896A28988BF5 0xC218525819F78451 0x21194EBB165733EA 0x6AFEE6D49E92B601 B74417EDDF22AC9F9E90F49142E86A2A11F48D36 514102454D0A87DB0767A1EBBE6A0531C18A9179

RUN     set -ex && \
        mkdir -p /usr/local/src/ && \
        cd /usr/local/src && \
        res=0; \
        wget -qO "tor-$WHIRLPOOL_TOR_VERSION.tar.gz" "$WHIRLPOOL_TOR_URL/tor-$WHIRLPOOL_TOR_VERSION.tar.gz" || res=$?; \
        if [ $res -gt 0 ]; then \
          wget -qO "tor-$WHIRLPOOL_TOR_VERSION.tar.gz" "$WHIRLPOOL_TOR_MIRROR_URL/tor-$WHIRLPOOL_TOR_VERSION.tar.gz"; \
        fi && \
        res=0; \
        wget -qO "tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum" "$WHIRLPOOL_TOR_URL/tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum" || res=$?; \
        if [ $res -gt 0 ]; then \
          wget -qO "tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum" "$WHIRLPOOL_TOR_MIRROR_URL/tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum"; \
        fi && \
        res=0; \
        wget -qO "tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum.asc" "$WHIRLPOOL_TOR_URL/tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum.asc" || res=$?; \
        if [ $res -gt 0 ]; then \
          wget -qO "tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum.asc" "$WHIRLPOOL_TOR_MIRROR_URL/tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum.asc"; \
        fi && \
        gpg --batch --keyserver "$WHIRLPOOL_TOR_GPG_KS_URI" --recv-keys $WHIRLPOOL_TOR_GPG_KEYS && \
        gpg --verify "tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum.asc" && \
        sha256sum --ignore-missing --check "tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum" && \
        tar -xzvf "tor-$WHIRLPOOL_TOR_VERSION.tar.gz" -C /usr/local/src && \
        cd "/usr/local/src/tor-$WHIRLPOOL_TOR_VERSION" && \
        ./configure \
            --disable-asciidoc \
            --sysconfdir=/etc \
            --disable-unittests && \
        make && make install && \
        cd .. && \
        rm -rf "tor-$WHIRLPOOL_TOR_VERSION" && \
        rm "tor-$WHIRLPOOL_TOR_VERSION.tar.gz" "tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum" "tor-$WHIRLPOOL_TOR_VERSION.tar.gz.sha256sum.asc"

FROM    debian:bullseye-slim AS whirlpool-builder
# Install whirlpool-cli
ENV     WHIRLPOOL_DIR                 /usr/local/whirlpool-cli
ENV     WHIRLPOOL_URL                 https://code.samourai.io/whirlpool/whirlpool-client-cli/uploads
ENV     WHIRLPOOL_VERSION             0.10.17.1
ENV     WHIRLPOOL_VERSION_HASH        ae3599226acb5f15a529db2859ad17ea
ENV     WHIRLPOOL_JAR                 "whirlpool-client-cli-$WHIRLPOOL_VERSION-run.jar"
ENV     WHIRLPOOL_SHA256              4d7d135ec71b0040e5da7751c68c2122236eaab875da5fc843fbe1f0596ad79a

# Install prerequisites
RUN     set -ex && \
        apt-get update && \
        apt-get install -y wget

RUN     set -ex && \
        mkdir -p "$WHIRLPOOL_DIR" && \
        cd "$WHIRLPOOL_DIR" && \
        echo "$WHIRLPOOL_SHA256 *$WHIRLPOOL_JAR" > WHIRLPOOL_CHECKSUMS && \
        wget -qO "$WHIRLPOOL_JAR" "$WHIRLPOOL_URL/$WHIRLPOOL_VERSION_HASH/$WHIRLPOOL_JAR" && \
        sha256sum -c WHIRLPOOL_CHECKSUMS 2>&1 | grep OK && \
        mv "$WHIRLPOOL_JAR" whirlpool-client-cli-run.jar

FROM    debian:bullseye-slim

ENV     TOR_HOME        /var/lib/tor
ENV     TOR_BIN         /usr/local/bin/tor
ENV     TOR_CONF        /etc/tor
ENV     TOR_MAN         /usr/local/share/man

ENV     WHIRLPOOL_HOME  /home/whirlpool
ENV     WHIRLPOOL_DIR   /usr/local/whirlpool-cli

ARG     WHIRLPOOL_LINUX_UID
ARG     WHIRLPOOL_LINUX_GID

RUN     mkdir -p /usr/share/man/man1

RUN     set -ex && \
        apt-get update && \
        apt-get install -qqy default-jdk libevent-dev

RUN     addgroup --system -gid ${WHIRLPOOL_LINUX_GID} whirlpool && \
        adduser --system --ingroup whirlpool -uid ${WHIRLPOOL_LINUX_UID} whirlpool

COPY    --from=tor-builder $TOR_BIN $TOR_BIN
COPY    --from=tor-builder $TOR_CONF $TOR_CONF
COPY    --from=tor-builder $TOR_MAN $TOR_MAN
COPY    --from=whirlpool-builder $WHIRLPOOL_DIR $WHIRLPOOL_DIR

RUN     chown -Rv whirlpool:whirlpool "$WHIRLPOOL_DIR" && \
        chmod -R 750 "$WHIRLPOOL_DIR"

RUN     mkdir -p "$WHIRLPOOL_HOME/.whirlpool-cli" && \
        chown -Rv whirlpool:whirlpool "$WHIRLPOOL_HOME" && \
        chmod -R 750 "$WHIRLPOOL_HOME"

# Copy restart script
COPY    ./restart.sh /restart.sh

RUN     chown whirlpool:whirlpool /restart.sh && \
        chmod u+x /restart.sh && \
        chmod g+x /restart.sh

# Expose HTTP API port
EXPOSE  8898

# Switch to user whirlpool
USER    whirlpool

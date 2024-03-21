FROM    debian:bullseye-slim AS builder


#################################################################
# INSTALL BITCOIN
#################################################################
ENV     BITCOIN_VERSION     26.0
ENV     BITCOIN_URL         https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}
ENV     BITCOIN_FILE_AMD64  bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz
ENV     BITCOIN_FILE_ARM64  bitcoin-${BITCOIN_VERSION}-aarch64-linux-gnu.tar.gz
ENV     BITCOIN_FILE_PPCLE  bitcoin-${BITCOIN_VERSION}-powerpc64le-linux-gnu.tar.gz
ENV     BITCOIN_SHASUMS     SHA256SUMS
ENV     BITCOIN_SHASUMS_ASC SHA256SUMS.asc
ENV     BITCOIN_BUILDERS    https://github.com/bitcoin-core/guix.sigs/archive/refs/heads/main.tar.gz
ENV     BITCOIN_BUILDERS_FILE builders.tar.gz


RUN     set -ex && \
        apt-get update && \
        apt-get install -qq --no-install-recommends ca-certificates dirmngr gosu gpg gpg-agent wget && \
        rm -rf /var/lib/apt/lists/*

# Build and install bitcoin binaries
RUN     set -ex && \
        cd /tmp && \
        arch="$(dpkg --print-architecture)"; arch="${arch##*-}"; \
        case "$arch" in \
          'amd64') \
            FILE="$BITCOIN_FILE_AMD64"; \
            ;; \
          'arm64') \
            FILE="$BITCOIN_FILE_ARM64"; \
            ;; \
          'ppc64el') \
          	FILE="$BITCOIN_FILE_PPCLE"; \
          	;; \
          *) echo >&2 "error: unsupported architecture '$arch' (likely packaging update needed)"; exit 1 ;; \
        esac; \
        wget -qO "$BITCOIN_BUILDERS_FILE" "$BITCOIN_BUILDERS" && \
        tar --strip-components=1 -xzvf "$BITCOIN_BUILDERS_FILE" guix.sigs-main/builder-keys && \
        gpg --import builder-keys/* && \
        wget -qO "$BITCOIN_SHASUMS" "$BITCOIN_URL/$BITCOIN_SHASUMS" && \
        wget -qO "$BITCOIN_SHASUMS_ASC" "$BITCOIN_URL/$BITCOIN_SHASUMS_ASC" && \
        wget -qO "$FILE" "$BITCOIN_URL/$FILE" && \
        sha256sum --ignore-missing --check "$BITCOIN_SHASUMS" && \
        gpg --batch --verify "$BITCOIN_SHASUMS_ASC" "$BITCOIN_SHASUMS" && \
        tar -xzvf "$FILE" -C /usr/local --strip-components=1 --exclude=*-qt && \
        rm -rf /tmp/*

FROM    debian:bullseye-slim

ENV     BITCOIN_HOME        /home/bitcoin

ARG     BITCOIND_LINUX_UID
ARG     BITCOIND_LINUX_GID
ARG     TOR_LINUX_GID

COPY    --from=builder /usr/local/ /usr/local/

RUN     set -ex && \
        apt-get update && \
        apt-get install -qq --no-install-recommends python3 jq cron && \
        apt-get clean && \
        rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Create groups bitcoin & tor
# Create user bitcoin and add it to groups
RUN     addgroup --system -gid ${BITCOIND_LINUX_GID} bitcoin && \
        addgroup --system -gid ${TOR_LINUX_GID} tor && \
        adduser --system --ingroup bitcoin -uid ${BITCOIND_LINUX_UID} bitcoin && \
        usermod -a -G tor bitcoin

# Create data directory
RUN     mkdir "$BITCOIN_HOME/.bitcoin" && \
        chown -h bitcoin:bitcoin "$BITCOIN_HOME/.bitcoin"

# Copy restart script
COPY    --chown=bitcoin:bitcoin --chmod=754 ./restart.sh /restart.sh

# Copy ban-knots.sh
COPY    --chown=bitcoin:bitcoin --chmod=754 ./ban-knots.sh /ban-knots.sh

# Copy crontab
COPY    --chown=bitcoin:bitcoin --chmod=644 ./crontab /etc/cron.d/crontab
RUN     crontab -u bitcoin /etc/cron.d/crontab && \
        chmod u+s /usr/sbin/cron

# Copy rpcauth.py script
COPY    --chown=bitcoin:bitcoin --chmod=754 ./rpcauth.py /rpcauth.py

EXPOSE  8333 9501 9502 28256

USER    bitcoin

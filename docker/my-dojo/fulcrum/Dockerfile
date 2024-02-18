FROM    debian:bullseye-slim AS builder

ENV     INDEXER_VERSION       1.9.8
ENV     INDEXER_SHASUMS       Fulcrum-${INDEXER_VERSION}-shasums.txt
ENV     INDEXER_ASC           ${INDEXER_SHASUMS}.asc
ENV     INDEXER_URL           https://github.com/cculianu/Fulcrum/releases/download
ENV     INDEXER_BUILD_AMD64   x86_64-linux
ENV     INDEXER_BUILD_ARM64   arm64-linux
ENV     INDEXER_FILES         /usr/fulcrum

RUN     apt-get update && \
        apt-get install -y wget curl gpg gpg-agent

# Create data directory
RUN     mkdir $INDEXER_FILES

# Install fulcrum
RUN     set -ex && \
        arch="$(dpkg --print-architecture)"; arch="${arch##*-}"; \
        case "$arch" in \
          'amd64') \
            INDEXER_FILE="Fulcrum-$INDEXER_VERSION-$INDEXER_BUILD_AMD64.tar.gz"; \
            ;; \
          'arm64') \
            INDEXER_FILE="Fulcrum-$INDEXER_VERSION-$INDEXER_BUILD_ARM64.tar.gz"; \
            ;; \
          *) echo >&2 "error: unsupported architecture '$arch' (likely packaging update needed)"; exit 1 ;; \
        esac; \
        wget -qO $INDEXER_FILE "$INDEXER_URL/v$INDEXER_VERSION/$INDEXER_FILE" && \
        wget -qO $INDEXER_SHASUMS "$INDEXER_URL/v$INDEXER_VERSION/$INDEXER_SHASUMS" && \
        wget -qO $INDEXER_ASC "$INDEXER_URL/v$INDEXER_VERSION/$INDEXER_ASC" && \
        curl https://raw.githubusercontent.com/Electron-Cash/keys-n-hashes/master/pubkeys/calinkey.txt | gpg --import && \
        gpg --verify $INDEXER_ASC && \
        sha256sum --ignore-missing -c $INDEXER_SHASUMS && \
        tar -xzvf ${INDEXER_FILE} -C "$INDEXER_FILES" --strip-components 1

FROM    debian:bullseye-slim

ENV     INDEXER_FILES         /usr/fulcrum
ENV     INDEXER_HOME          /home/fulcrum
ENV     SSL_CERTFILE          ${INDEXER_HOME}/fulcrum.crt
ENV     SSL_KEYFILE           ${INDEXER_HOME}/fulcrum.key

ARG     FULCRUM_LINUX_GID
ARG     FULCRUM_LINUX_UID

RUN     apt-get update && \
        apt-get install -y openssl && \
        apt-get clean && \
        rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Create group and user indexer
RUN     addgroup --system -gid ${FULCRUM_LINUX_GID} fulcrum && \
        adduser --system --ingroup fulcrum -uid ${FULCRUM_LINUX_UID} fulcrum

# Create data directory
RUN     mkdir -p "$INDEXER_HOME/.fulcrum/db" && \
        chown -h fulcrum:fulcrum "$INDEXER_HOME/.fulcrum" && \
        chown -h fulcrum:fulcrum "$INDEXER_HOME/.fulcrum/db"

COPY    --from=builder "$INDEXER_FILES" "$INDEXER_FILES"

# Change file ownership
RUN     chown -R fulcrum:fulcrum "$INDEXER_FILES"

# Copy restart script
COPY    ./restart.sh /restart.sh
RUN     chown fulcrum:fulcrum /restart.sh && \
        chmod 777 /restart.sh

# Copy fulcrum.conf
COPY    ./fulcrum.conf /etc/fulcrum.conf
RUN     chown fulcrum:fulcrum /etc/fulcrum.conf && \
        chmod 777 /etc/fulcrum.conf

USER    fulcrum

EXPOSE  50001 50002

STOPSIGNAL SIGINT

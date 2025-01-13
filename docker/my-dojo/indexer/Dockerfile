FROM    debian:bullseye-slim AS builder

ENV     INDEXER_VERSION       v0.6.0
ENV     INDEXER_SHASUMS       addrindexrs-${INDEXER_VERSION}-binary-fingerprints.txt
ENV     INDEXER_ASC           ${INDEXER_SHASUMS}.sig
ENV     INDEXER_URL           https://github.com/Dojo-Open-Source-Project/addrindexrs/releases/download
ENV     INDEXER_BUILD_AMD64   x86_64-linux
ENV     INDEXER_BUILD_ARM64   arm64-linux
ENV     PGP_KEY               E53AD419B242822F19E23C6D3033D463D6E544F6

RUN     apt-get update && \
        apt-get install -y wget gpg ca-certificates

# Get PGP key
RUN     gpg --batch --recv-keys $PGP_KEY

# Install addrindexrs
WORKDIR    /tmp/addrindexrs
RUN       set -ex && \
          arch="$(dpkg --print-architecture)"; arch="${arch##*-}"; \
             case "$arch" in \
               'amd64') \
                 INDEXER_FILE="addrindexrs-$INDEXER_VERSION-$INDEXER_BUILD_AMD64"; \
               ;; \
               'arm64') \
                 INDEXER_FILE="addrindexrs-$INDEXER_VERSION-$INDEXER_BUILD_ARM64"; \
               ;; \
               *) echo >&2 "error: unsupported architecture '$arch' (likely packaging update needed)"; exit 1 ;; \
             esac; \
          wget -qO $INDEXER_FILE "$INDEXER_URL/$INDEXER_VERSION/$INDEXER_FILE" && \
          wget -qO $INDEXER_SHASUMS "$INDEXER_URL/$INDEXER_VERSION/$INDEXER_SHASUMS" && \
          wget -qO $INDEXER_ASC "$INDEXER_URL/$INDEXER_VERSION/$INDEXER_ASC" && \
          gpg --batch --verify "$INDEXER_ASC" "$INDEXER_SHASUMS" && \
          sha256sum --ignore-missing --check "$INDEXER_SHASUMS" && \
          mv "$INDEXER_FILE" addrindexrs

FROM    debian:bullseye-slim

ENV     INDEXER_HOME        /home/indexer

ARG     INDEXER_LINUX_GID
ARG     INDEXER_LINUX_UID

# Create group and user indexer
RUN     addgroup --system -gid ${INDEXER_LINUX_GID} indexer && \
        adduser --system --ingroup indexer -uid ${INDEXER_LINUX_UID} indexer

COPY    --from=builder --chown=indexer:indexer --chmod=754 /tmp/addrindexrs/addrindexrs /usr/bin/addrindexrs

# Create data directory
RUN     mkdir "$INDEXER_HOME/addrindexrs" && \
        chown -h indexer:indexer "$INDEXER_HOME/addrindexrs"

# Copy restart script
COPY    --chown=indexer:indexer --chmod=754 ./restart.sh /restart.sh

USER    indexer

EXPOSE  50001
EXPOSE  8080

STOPSIGNAL SIGINT

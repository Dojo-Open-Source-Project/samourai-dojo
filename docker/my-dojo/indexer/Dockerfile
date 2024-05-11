FROM    rust:1.42.0-slim-buster AS builder

ENV     INDEXER_VERSION             0.6.0
ENV     FILE_NAME                   v$INDEXER_VERSION.tar.gz
ENV     FINGERPRINT_FILE_NAME       addrindexrs-v$INDEXER_VERSION-fingerprints.txt
ENV     FINGERPRINT_SIG_FILE_NAME   $FINGERPRINT_FILE_NAME.sig

ENV     INDEXER_URL                 https://github.com/Dojo-Open-Source-Project/addrindexrs/archive/refs/tags/v$INDEXER_VERSION.tar.gz
ENV     FINGERPRINT_URL             https://github.com/Dojo-Open-Source-Project/addrindexrs/releases/download/v$INDEXER_VERSION/$FINGERPRINT_FILE_NAME
ENV     FINGERPRINT_SIG_URL         https://github.com/Dojo-Open-Source-Project/addrindexrs/releases/download/v$INDEXER_VERSION/$FINGERPRINT_SIG_FILE_NAME

ENV     PGP_KEY                     377DE507FDC47F020099E342CFA54E4C0CD58DF0

RUN     apt-get update && \
        apt-get install -y clang cmake wget gpg

# Get PGP key
RUN     gpg --batch --recv-keys $PGP_KEY

# Install addrindexrs
WORKDIR    /tmp/addrindexrs
RUN        wget -q "$INDEXER_URL" "$FINGERPRINT_URL" "$FINGERPRINT_SIG_URL"
RUN        gpg --batch --verify "$FINGERPRINT_SIG_FILE_NAME" "$FINGERPRINT_FILE_NAME"
RUN        sha256sum --ignore-missing --check "$FINGERPRINT_FILE_NAME"
RUN        tar -xzf "$FILE_NAME" --strip-components=1
RUN        rm "$FILE_NAME"
RUN        cargo install --locked --path .

FROM    debian:buster-slim

ENV     INDEXER_HOME        /home/indexer

ARG     INDEXER_LINUX_GID
ARG     INDEXER_LINUX_UID

COPY    --from=builder /usr/local/cargo/bin/addrindexrs /usr/bin/addrindexrs

# Create group and user indexer
RUN     addgroup --system -gid ${INDEXER_LINUX_GID} indexer && \
        adduser --system --ingroup indexer -uid ${INDEXER_LINUX_UID} indexer

# Create data directory
RUN     mkdir "$INDEXER_HOME/addrindexrs" && \
        chown -h indexer:indexer "$INDEXER_HOME/addrindexrs"

# Copy restart script
COPY    --chown=indexer:indexer --chmod=754 ./restart.sh /restart.sh

USER    indexer

EXPOSE  50001
EXPOSE  8080

STOPSIGNAL SIGINT

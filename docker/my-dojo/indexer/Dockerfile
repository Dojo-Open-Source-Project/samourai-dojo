FROM    rust:1.42.0-slim-buster AS builder

ENV     INDEXER_VERSION             0.6.0
ENV     FILE_NAME                   addrindexrs-v$INDEXER_VERSION.tar.gz
ENV     FINGERPRINT_FILE_NAME       addrindexrs-v$INDEXER_VERSION-fingerprints.txt
ENV     FINGERPRINT_SIG_FILE_NAME   addrindexrs-v$INDEXER_VERSION-fingerprints.txt.sig
ENV     FINGERPRINT_HASH            89ab60c4b1af3df55a6817e69049ecaf
ENV     FINGERPRINT_SIG_HASH        1e77197ff4ea46a6f10530b50ae911f7

ENV     INDEXER_URL                 https://code.samourai.io/dojo/addrindexrs/-/archive/v$INDEXER_VERSION/$FILE_NAME
ENV     FINGERPRINT_URL             https://code.samourai.io/dojo/addrindexrs/uploads/$FINGERPRINT_HASH/$FINGERPRINT_FILE_NAME
ENV     FINGERPRINT_SIG_URL         https://code.samourai.io/dojo/addrindexrs/uploads/$FINGERPRINT_SIG_HASH/$FINGERPRINT_SIG_FILE_NAME

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

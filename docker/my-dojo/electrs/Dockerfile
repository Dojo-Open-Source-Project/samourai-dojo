FROM    debian:trixie-slim AS builder

ENV     ELECTRS_VERSION     v0.11.1
ENV     ARCHIVE_URL         https://github.com/Dojo-Open-Source-Project/electrs-binaries/archive/refs/heads/master.tar.gz
ENV     ELECTRS_FILE_AMD64  electrs-x86_64-linux
ENV     ELECTRS_FILE_ARM64  electrs-arm64-linux

RUN     apt-get update && \
        apt-get install -y wget curl gpg gpg-agent

# Install electrs
RUN     set -ex && \
        mkdir -p /tmp/electrs /opt/electrs && \
        cd /tmp/electrs && \
        arch="$(dpkg --print-architecture)"; arch="${arch##*-}"; \
        case "$arch" in \
          'amd64') \
            FILE="$ELECTRS_FILE_AMD64"; \
            ;; \
          'arm64') \
            FILE="$ELECTRS_FILE_ARM64"; \
            ;; \
          *) echo >&2 "error: unsupported architecture '$arch' (likely packaging update needed)"; exit 1 ;; \
        esac; \
        wget -qO electrs.tar.gz "$ARCHIVE_URL" && \
        tar -xzvf electrs.tar.gz -C "/tmp/electrs" --strip-components 1 && \
        cd /tmp/electrs/dist && \
        cd "$ELECTRS_VERSION" && \
        sha256sum --check SHA256SUMS.txt && \
        gpg --batch --recv-keys E53AD419B242822F19E23C6D3033D463D6E544F6 && \
        gpg --batch --verify SHA256SUMS.txt.asc SHA256SUMS.txt && \
        cp "$FILE" /opt/electrs/electrs

FROM    debian:trixie-slim

ENV     ELECTRS_HOME        /home/electrs

ARG     ELECTRS_LINUX_UID
ARG     ELECTRS_LINUX_GID

RUN     apt-get update && \
        apt-get install -y adduser librocksdb-dev && \
        apt-get clean && \
        rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY    --from=builder /opt/electrs/electrs /usr/bin/electrs

# Create group and user electrs
RUN     addgroup --system -gid ${ELECTRS_LINUX_GID} electrs && \
        adduser --system --ingroup electrs -uid ${ELECTRS_LINUX_UID} electrs

# Create data directory
RUN     mkdir -p "$ELECTRS_HOME/electrs" && \
        mkdir -p "$ELECTRS_HOME/db" && \
        touch "/electrs.toml" && \
        chown -h electrs:electrs "$ELECTRS_HOME/electrs" && \
        chown -h electrs:electrs "$ELECTRS_HOME/db" && \
        chown -h electrs:electrs "/electrs.toml"

# Copy restart script
COPY    --chown=electrs:electrs --chmod=777 ./restart.sh /restart.sh

USER    electrs

EXPOSE  50001

STOPSIGNAL SIGINT

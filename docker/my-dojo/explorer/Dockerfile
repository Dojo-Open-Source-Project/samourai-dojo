FROM    node:20-alpine3.18 AS builder

ENV     NODE_ENV             production

ENV     APP_DIR              /home/node/app

ENV     EXPLORER_VERSION     3.4.0+SW
ENV     EXPLORER_URL         https://github.com/Dojo-Open-Source-Project/btc-rpc-explorer/archive/refs/tags/v$EXPLORER_VERSION.tar.gz

# Install netcat
RUN     set -ex && \
        apk --no-cache add gcc g++ make python3 git

# Update NPM to latest version
RUN     set -ex && \
        npm i -g npm

# Download the source code and install it
RUN     set -ex && \
        mkdir "$APP_DIR" && \
        wget -qO explorer.tar.gz "$EXPLORER_URL" && \
        tar -xzvf explorer.tar.gz -C "$APP_DIR/" --strip-components 1 && \
        rm explorer.tar.gz && \
        cd "$APP_DIR" && \
        npm install --omit=dev

FROM    node:20-alpine3.18

ENV     NODE_ENV        production
ENV     APP_DIR         /home/node/app

RUN     set -ex && \
        apk --no-cache add bash netcat-openbsd

COPY    --chown=node:node --from=builder $APP_DIR $APP_DIR

# Copy restart script
COPY    --chown=node:node --chmod=754 ./restart.sh "$APP_DIR/restart.sh"

EXPOSE  3002

USER    node

STOPSIGNAL SIGKILL

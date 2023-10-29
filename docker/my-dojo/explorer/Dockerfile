FROM    node:20-alpine AS builder

ENV     NODE_ENV             production

ENV     APP_DIR              /home/node/app

ENV     EXPLORER_VERSION     3.4.0+SW
ENV     EXPLORER_URL         https://code.samourai.io/dojo/btc-rpc-explorer/-/archive/v$EXPLORER_VERSION/btc-rpc-explorer-v$EXPLORER_VERSION.tar.gz

# Install netcat
RUN     set -ex && \
        apk --no-cache add gcc g++ make python3 git netcat-openbsd

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

FROM    node:20-alpine

ENV     NODE_ENV        production
ENV     APP_DIR         /home/node/app

RUN     set -ex && \
        apk --no-cache add bash

COPY    --from=builder $APP_DIR $APP_DIR

# Copy restart script
COPY    ./restart.sh "$APP_DIR/restart.sh"

RUN     chown node:node "$APP_DIR/restart.sh" && \
        chmod u+x "$APP_DIR/restart.sh" && \
        chmod g+x "$APP_DIR/restart.sh"

# Change ownership of all files
RUN     chown -R node:node "$APP_DIR"

EXPOSE  3002

USER    node

STOPSIGNAL SIGKILL

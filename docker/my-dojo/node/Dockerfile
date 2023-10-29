FROM    node:20-alpine AS builder

ENV     NODE_ENV    production
ENV     APP_DIR     /home/node/app

RUN     set -ex && \
        apk --no-cache add gcc g++ make python3 curl cmake

# Update NPM to latest version
RUN     set -ex && \
        npm i -g npm

# Create app directory
RUN     mkdir "$APP_DIR"

# Copy app source files into APP_DIR
COPY    . "$APP_DIR"

# Install node modules required by the app
RUN     cd "$APP_DIR" && \
        npm install --omit=dev

FROM    node:20-alpine

ENV     NODE_ENV    production
ENV     APP_DIR     /home/node/app

ARG     TOR_LINUX_GID

RUN     set -ex && \
        apk --no-cache add shadow bash

# Add node user to tor group
RUN     addgroup -S -g ${TOR_LINUX_GID} tor && \
        usermod -a -G tor node

# Install PM2
RUN     npm install -g pm2

# Copy app source files into APP_DIR
COPY    --from=builder $APP_DIR $APP_DIR

# Copy config file
COPY    ./docker/my-dojo/node/keys.index.js "$APP_DIR/keys/index.js"

# Copy PM2 config file
COPY    ./docker/my-dojo/node/pm2.config.cjs "$APP_DIR/pm2.config.cjs"

# Copy restart script
COPY    ./docker/my-dojo/node/restart.sh "$APP_DIR/restart.sh"

RUN     chmod u+x "$APP_DIR/restart.sh" && \
        chmod g+x "$APP_DIR/restart.sh"

# Copy wait-for-it script
COPY    ./docker/my-dojo/node/wait-for-it.sh "$APP_DIR/wait-for-it.sh"

RUN     chmod u+x "$APP_DIR/wait-for-it.sh" && \
        chmod g+x "$APP_DIR/wait-for-it.sh"

# Change ownership of all files
RUN     chown -R node:node "$APP_DIR"

USER    node

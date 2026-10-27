FROM    ghcr.io/pnpm/pnpm:12 AS base

ENV     APP_DIR=/home/node/app

RUN     set -ex && \
        apt-get update && \
        apt-get install -y gcc g++ make python3 curl cmake
RUN     pnpm runtime set node 24 -g

WORKDIR $APP_DIR

COPY    . .

FROM    base AS prod-deps
RUN     --mount=type=cache,id=pnpm,target=/var/cache/pnpm \
        pnpm install --store-dir /var/cache/pnpm --prod --frozen-lockfile

FROM    base AS build

ARG     COMMON_BTC_NETWORK=mainnet
ENV     COMMON_BTC_NETWORK=$COMMON_BTC_NETWORK
ENV     DOJO_DOCKER_BUILD=1

RUN     --mount=type=cache,id=pnpm,target=/var/cache/pnpm \
        pnpm install --store-dir /var/cache/pnpm --frozen-lockfile
RUN     pnpm run build

FROM    base

ENV     NODE_ENV=production
ENV     APP_DIR=/home/node/app
ENV     HOME=/home/node
ENV     PATH=/opt/pm2/node_modules/.bin:$PATH

# Use the global Node.js installed in base instead of provisioning a runtime at startup.
ENV     PNPM_SHIM_BYPASS=1

ARG     TOR_LINUX_GID

RUN     set -ex && \
        apt-get install -y adduser bash

# Create the runtime account and make its existing home writable for PM2.
RUN     addgroup --system node && \
        adduser --system --ingroup node --home /home/node --no-create-home --shell /bin/bash node && \
        chown node:node /home/node

# Add node user to tor group
RUN     addgroup --system -gid ${TOR_LINUX_GID} tor && \
        usermod -a -G tor node

# Install PM2 for process supervision; application IPC uses ZeroMQ.
RUN     mkdir -p /opt/pm2 && \
        printf '{"private":true}\n' > /opt/pm2/package.json && \
        pnpm --dir /opt/pm2 add pm2

# pnpm creates shim target files with mode 0600; the runtime user must read them.
RUN     chmod a+r "$PNPM_HOME"/bin/.pnpm-shim-v1-*-target

# Keep the runtime files from the source tree, then add the build and production packages.
COPY    --chown=node:node . "$APP_DIR"
COPY    --chown=node:node --from=build "$APP_DIR/dist" "$APP_DIR/dist"
COPY    --chown=node:node --from=prod-deps "$APP_DIR/node_modules" "$APP_DIR/node_modules"

# Copy PM2 config file
COPY    --chown=node:node ./docker/my-dojo/node/pm2.config.cjs "$APP_DIR/pm2.config.cjs"

# Copy restart script
COPY    --chown=node:node --chmod=754 ./docker/my-dojo/node/restart.sh "$APP_DIR/restart.sh"

# Copy wait-for-it script
COPY    --chown=node:node --chmod=754 ./docker/my-dojo/node/wait-for-it.sh "$APP_DIR/wait-for-it.sh"

USER    node

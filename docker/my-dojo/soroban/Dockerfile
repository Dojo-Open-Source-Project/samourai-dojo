#
# Build torproject from source
#
FROM    alpine:3.20 AS torproject

ENV     TOR_GIT_URL     https://git.torproject.org/tor.git
ENV     TOR_VERSION     tor-0.4.8.14

RUN     apk --update --no-cache add ca-certificates
RUN     apk --no-cache add alpine-sdk automake autoconf
RUN     apk --no-cache add openssl-dev libevent-dev zlib-dev

RUN     git clone $TOR_GIT_URL /tor -b $TOR_VERSION --depth 1

WORKDIR /tor

RUN     ./autogen.sh

RUN     ./configure                                           \
        --disable-system-torrc                                \
        --disable-asciidoc                                    \
        --disable-unittests                                   \
        --prefix=/stage

RUN     make -j 4 && make install

RUN     cp /stage/etc/tor/torrc.sample /stage/.torrc

#
# Final Tor image
#
FROM    alpine:3.20 AS soroban-tor

ARG     SOROBAN_TOR_LINUX_UID
ARG     SOROBAN_TOR_LINUX_GID

RUN     apk --update --no-cache add ca-certificates bash
RUN     apk --no-cache add openssl libevent zlib curl

COPY    --from=torproject /stage /usr/local

USER    root
RUN     addgroup -g ${SOROBAN_TOR_LINUX_GID} -S tor && \
        adduser --system --ingroup tor --uid ${SOROBAN_TOR_LINUX_UID} tor
RUN     mkdir -p /var/lib/tor
RUN     chown tor:tor /var/lib/tor

USER    tor
RUN     cp /usr/local/etc/tor/torrc.sample /home/tor/.torrc

EXPOSE  9050


#
# Build go app
#
FROM    golang:1.22.8-alpine3.20 AS gobuild

ENV     SOROBAN_VERSION         0.4.1
ENV     SOROBAN_URL             https://github.com/Dojo-Open-Source-Project/soroban/archive/refs/tags/v$SOROBAN_VERSION.tar.gz

RUN     apk --no-cache --update add ca-certificates
RUN     apk --no-cache --update add alpine-sdk linux-headers wget

RUN     set -ex && \
        mkdir -p /stage && \
        mkdir -p /src && \
        cd ~ && \
        wget -qO soroban.tar.gz "$SOROBAN_URL" && \
        tar -xzvf soroban.tar.gz -C /src --strip-components 1 && \
        rm soroban.tar.gz && \
        cd /src

WORKDIR /src
RUN     go mod download
RUN     go build -a -tags netgo -o /stage/soroban-server ./cmd/server

#
# Final Soroban image
#
FROM    soroban-tor

ENV     SOROBAN_HOME            /home/soroban
ARG     SOROBAN_LINUX_UID
ARG     SOROBAN_LINUX_GID

COPY    --from=gobuild /stage/soroban-server /usr/local/bin

# Create Soroban group and user
USER    root

RUN     addgroup -g ${SOROBAN_LINUX_GID} -S soroban && \
        adduser --system --ingroup soroban --uid ${SOROBAN_LINUX_UID} soroban

# Create data directory
RUN     mkdir "$SOROBAN_HOME/data" && \
        chown -h soroban:soroban "$SOROBAN_HOME/data"

RUN     cp /home/tor/.torrc /home/soroban/.torrc

# Copy restart script
COPY    --chown=soroban:soroban --chmod=754 ./restart.sh /restart.sh

# Copy healthcheck script
COPY    --chown=soroban:soroban --chmod=754 ./healthcheck.sh /healthcheck.sh

# Start Soroban
USER    soroban

ENTRYPOINT [ "/restart.sh" ]

STOPSIGNAL SIGINT

# Set healthcheck
HEALTHCHECK --interval=600s --timeout=60s --start-period=600s --start-interval=30s CMD /healthcheck.sh

import { SocksClient } from 'socks'
import { Agent, buildConnector } from 'undici'

/**
 * Since socks does not guess HTTP ports, we need to do that.
 *
 * @param protocol Upper layer protocol, "http:" or "https:"
 * @param port A string containing the port number of the URL, maybe empty.
 */
function resolvePort(protocol, port) {
    return port ? Number.parseInt(port, 10) : (protocol === 'http:' ? 80 : 443)
}

/**
 * Create an Undici connector which establish the connection through socks proxies.
 *
 * If the proxies is an empty array, it will connect directly.
 *
 * @param proxies The proxy server to use or the list of proxy servers to chain.
 * @param tlsOpts TLS upgrade options.
 */
export function socksConnector(proxies, tlsOpts = {}) {
    const chain = Array.isArray(proxies) ? proxies : [proxies]
    const { timeout = 1e4 } = tlsOpts
    const undiciConnect = buildConnector(tlsOpts)

    return async (options, callback) => {
        let { protocol, hostname, port, httpSocket } = options

        for (let i = 0; i < chain.length; i++) {
            const next = chain[i + 1]

            const destination = i === chain.length - 1 ? {
                host: hostname,
                port: resolvePort(protocol, port),
            } : {
                port: next.port,
                host: next.host ?? next.ipaddress,
            }

            const socksOpts = {
                command: 'connect',
                proxy: chain[i],
                timeout,
                destination,
                existing_socket: httpSocket,
            }

            try {
                const r = await SocksClient.createConnection(socksOpts)
                httpSocket = r.socket
            } catch (error) {
                return callback(error, null)
            }
        }

        // httpSocket may not exist when the chain is empty.
        if (httpSocket && protocol !== 'https:') {
            return callback(null, httpSocket.setNoDelay())
        }

        /*
         * There are 2 cases here:
         * If httpSocket doesn't exist, let Undici make a connection.
         * If httpSocket exists & protocol is HTTPS, do TLS upgrade.
         */
        return undiciConnect({ ...options, httpSocket }, callback)
    }
}

/**
 * Create a Undici Agent with socks connector.
 *
 * If the proxies is an empty array, it will connect directly.
 *
 * @param proxies The proxy server to use or the list of proxy servers to chain.
 * @param options Additional options passed to the Agent constructor.
 */
export function socksDispatcher(proxies, options = {}) {
    const { connect, ...rest } = options
    return new Agent({ ...rest, connect: socksConnector(proxies, connect) })
}

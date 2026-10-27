import type { SocksClientOptions } from "socks";
import { SocksClient } from "socks";
import { Agent, buildConnector } from "undici";

interface SocksProxyConfig {
	type?: number;
	host?: string;
	ipaddress?: string;
	port: number;
}

type TlsOptions = NonNullable<Parameters<typeof buildConnector>[0]>;
type SocksDispatcherOptions = Omit<
	NonNullable<ConstructorParameters<typeof Agent>[0]>,
	"connect"
> & { connect?: TlsOptions };

/**
 * Since socks does not guess HTTP ports, we need to do that.
 */
function resolvePort(protocol?: string, port?: string | number) {
	return port
		? Number.parseInt(String(port), 10)
		: protocol === "http:"
			? 80
			: 443;
}

/**
 * Create an Undici connector which establish the connection through socks proxies.
 *
 * If the proxies is an empty array, it will connect directly.
 */
export function socksConnector(
	proxies?: SocksProxyConfig | SocksProxyConfig[],
	tlsOpts: TlsOptions = {},
) {
	const chain = Array.isArray(proxies) ? proxies : [proxies];
	const { timeout = 1e4 } = tlsOpts;
	const undiciConnect = buildConnector(tlsOpts);

	return (async (
		options: buildConnector.Options,
		callback: buildConnector.Callback,
	) => {
		let { protocol, hostname, port, httpSocket } = options;

		for (let i = 0; i < chain.length; i++) {
			const next = chain[i + 1];

			const destination =
				i === chain.length - 1
					? {
							host: hostname,
							port: resolvePort(protocol, port),
						}
					: {
							port: next?.port,
							host: next?.host ?? next?.ipaddress,
						};

			const socksOpts = {
				command: "connect",
				proxy: chain[i],
				timeout,
				destination,
				existing_socket: httpSocket,
			};

			try {
				const r = await SocksClient.createConnection(
					socksOpts as SocksClientOptions,
				);
				httpSocket = r.socket;
			} catch (error) {
				return callback(
					error instanceof Error ? error : new Error(String(error)),
					null,
				);
			}
		}

		// httpSocket may not exist when the chain is empty.
		if (httpSocket && protocol !== "https:") {
			return callback(null, httpSocket.setNoDelay());
		}

		/*
		 * There are 2 cases here:
		 * If httpSocket doesn't exist, let Undici make a connection.
		 * If httpSocket exists & protocol is HTTPS, do TLS upgrade.
		 */
		return undiciConnect({ ...options, httpSocket }, callback);
	}) satisfies buildConnector.connector;
}

/**
 * Create a Undici Agent with socks connector.
 *
 * If the proxies is an empty array, it will connect directly.
 */
export function socksDispatcher(
	proxies?: SocksProxyConfig | SocksProxyConfig[],
	options: SocksDispatcherOptions = {},
) {
	const { connect, ...rest } = options;
	return new Agent({ ...rest, connect: socksConnector(proxies, connect) });
}

/*!
 * accounts/notification-web-sockets.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import cloneDeep from "lodash.clonedeep";
import QuickLRU from "quick-lru";
import { WebSocket, WebSocketServer } from "ws";
import authMgr from "../lib/auth/authorizations-manager.js";
import db from "../lib/db/mysql-db-wrapper.js";
import Logger from "../lib/logger.js";
import apiHelper from "./api-helper.js";
import status from "./status.js";

const debug = process.argv.includes("ws-debug");

type ClientWebSocket = WebSocket & {
	id: number;
	subs: string[];
};

interface NotificationTxEndpoint {
	addr?: string;
	xpub?: { m?: string };
	topic?: string | null;
	pubkey?: unknown;
	[key: string]: unknown;
}

interface NotificationTxInput extends NotificationTxEndpoint {
	prev_out?: NotificationTxEndpoint;
}

interface NotificationTx {
	hash?: string;
	inputs: NotificationTxInput[];
	out: NotificationTxEndpoint[];
	[key: string]: unknown;
}

/**
 * A class providing a notifications server over web sockets
 */
class NotificationsService {
	declare ws: WebSocketServer | null;
	declare conn: Record<number, ClientWebSocket>;
	declare subs: Record<string, number[]>;
	declare cachePubKeys: Map<string, unknown>;
	declare cacheSubs: QuickLRU<string, boolean>;
	/**
	 * Constructor
	 */
	constructor(
		server?: ConstructorParameters<typeof WebSocketServer>[0]["server"],
	) {
		// Web sockets server
		this.ws = null;
		// Dictionary of connections
		this.conn = {};
		// Dictionary of subscriptions
		this.subs = {};
		// Dictionary mapping addresses to pubkeys
		this.cachePubKeys = new Map();

		// Cache registering the most recent subscriptions received
		// Used to filter multiple subscriptions sent by external apps.
		this.cacheSubs = new QuickLRU({
			// Maximum number of subscriptions to store in cache
			// Estimate: 1000 clients with an average of 5 subscriptions
			maxSize: 5000,
			// Maximum age for items in the cache (1mn)
			maxAge: 60 * 1000,
		});

		// Initialize the web socket server
		this._initWSServer(server);
	}

	/**
	 * Initialize the web sockets server
	 */
	_initWSServer(
		server?: ConstructorParameters<typeof WebSocketServer>[0]["server"],
	) {
		this.ws = new WebSocketServer({ server });

		Logger.info("API : Created WebSocket server");

		this.ws.on("connection", (conn: WebSocket) => {
			try {
				const client = conn as ClientWebSocket;
				client.id = status.sessions++;
				client.subs = [];

				debug && Logger.info(`API : Client ${client.id} connected`);

				client.on("close", () => {
					this._closeWSConnection(client, false);
				});

				client.on("error", (error?: unknown) => {
					Logger.error(
						error,
						`API : NotificationsService : Error on connection ${client.id}`,
					);
					if (client.readyState === WebSocket.OPEN)
						this._closeWSConnection(client, true);
				});

				client.on("message", (message: Buffer, isBinary: boolean) => {
					if (!isBinary)
						this._handleWSMessage(message.toString("utf8"), client);
					else this._closeWSConnection(client, true);
				});

				this.conn[client.id] = client;
				status.clients = status.clients + 1;
				status.maxConn = Math.max(
					status.maxConn,
					Object.keys(this.conn).length,
				);
			} catch (error) {
				Logger.error(
					error,
					"API : NotificationsService._initWSServer() : Error during connection setup",
				);
			}
		});
	}

	/**
	 * Close a web sockets connection
	 */
	_closeWSConnection(conn: ClientWebSocket, forcedClose: boolean) {
		try {
			for (const topic of conn.subs) {
				this._unsub(topic, conn.id);

				// Close initiated by client, remove subscriptions from cache
				if (!forcedClose && this.cacheSubs.has(topic))
					this.cacheSubs.delete(topic);
			}

			if (this.conn[conn.id]) {
				delete this.conn[conn.id];
				status.clients = status.clients - 1;
			}

			// Close initiated by server
			if (forcedClose && conn.readyState === WebSocket.OPEN)
				conn.close(1008, "Get out of here!");

			debug && Logger.info(`API : Client ${conn.id} disconnected`);
		} catch (error) {
			Logger.error(error, "API : NotificationsService._closeWSConnection()");
		}
	}

	/**
	 * Filter potential duplicate subscriptions
	 */
	_filterWSMessage(msg?: string) {
		if (this.cacheSubs.has(msg)) {
			debug && Logger.info("API : Duplicate subscriptions detected");
			return false;
		} else {
			this.cacheSubs.set(msg, true);
			return true;
		}
	}

	/**
	 * Handle messages received over the web sockets
	 * (subscriptions)
	 */
	_handleWSMessage(msg: string, conn: ClientWebSocket) {
		try {
			debug && Logger.info(`API : Received from client ${conn.id}: ${msg}`);

			const data = JSON.parse(msg) as {
				op?: string;
				at?: string;
				addr?: string;
			};

			// Check authentication (if needed)
			if (authMgr.authActive && authMgr.isMandatory) {
				try {
					authMgr.isAuthenticated(data.at);
				} catch (error) {
					this.notifyAuthError(error, conn.id);
					return;
				}
			}

			switch (data.op) {
				case "ping":
					conn.send('{"op": "pong"}');
					break;
				case "addr_sub":
					if (data.addr) {
						// Check for potential flood by clients
						// subscribing for the same xpub again and again
						if (this._filterWSMessage(data.addr))
							this._entitysub(data.addr, conn);
						else this._closeWSConnection(conn, true);
					}
					break;
				case "blocks_sub":
					this._addsub("block", conn);
					break;
			}
		} catch (error) {
			Logger.error(
				error,
				"API : NotificationsService._handleWSMessage() : WebSocket message error",
			);
		}
	}

	/**
	 * Subscribe to a list of addresses/xpubs/pubkeys
	 */
	_entitysub(topic: string, conn: ClientWebSocket) {
		const valid = apiHelper.parseEntities(topic);

		for (const a in valid.addrs) {
			const address = valid.addrs[a];
			this._addsub(address, conn);
			if (valid.pubkeys[a]) {
				this.cachePubKeys.set(address, valid.pubkeys[a]);
			}
		}

		for (const xpub of valid.xpubs) this._addsub(xpub, conn);
	}

	/**
	 * Subscribe to a topic
	 */
	_addsub(topic: string, conn: ClientWebSocket) {
		if (conn.subs.includes(topic)) return false;

		conn.subs.push(topic);

		if (!this.subs[topic]) this.subs[topic] = [];

		this.subs[topic].push(conn.id);

		debug && Logger.info(`API : Client ${conn.id} subscribed to ${topic}`);
	}

	/**
	 * Unsubscribe from a topic
	 */
	_unsub(topic: string, cid: number) {
		if (!this.subs[topic]) return false;

		const index = this.subs[topic].indexOf(cid);
		if (index < 0) return false;

		this.subs[topic].splice(index, 1);

		if (this.subs[topic].length === 0) {
			delete this.subs[topic];
			if (this.cachePubKeys.has(topic)) this.cachePubKeys.delete(topic);
		}

		return true;
	}

	/**
	 * Dispatch a notification to all clients
	 * who have subscribed to a topic
	 */
	dispatch(topic: string, msg: string) {
		if (!this.subs[topic]) return;

		for (const cid of this.subs[topic]) {
			if (!this.conn[cid]) continue;

			try {
				this.conn[cid].send(msg);
			} catch (error) {
				Logger.error(
					error,
					`API : NotificationsService.dispatch() : Error sending dispatch for ${topic} to client ${cid}`,
				);
			}
		}
	}

	/**
	 * Dispatch notifications for a new block
	 */
	notifyBlock({ height, hash }: { height: number; hash: string }) {
		try {
			const data = {
				op: "block",
				x: {
					height: height,
					hash: hash,
				},
			};
			this.dispatch("block", JSON.stringify(data));
		} catch (error) {
			Logger.error(error, "API : NotificationsService.notifyBlock()");
		}
	}

	/**
	 * Dispatch notifications for a transaction
	 *
	 * Transaction notification operates within these constraints:
	 *   1. Notify each client ONCE of a relevant transaction
	 *   2. Maintain privacy of other parties when transactions are between clients
	 *
	 *   Clients subscribe to a list of xpubs and addresses. Transactions identify
	 *   address and xpub if available on inputs and outputs, omitting inputs and
	 *   outputs for untracked addresses.
	 *
	 *   Example:
	 *   tx
	 *     inputs
	 *       addr1
	 *       xpub2
	 *     outputs
	 *       xpub1
	 *       xpub2
	 *       addr2
	 *       xpub3
	 *
	 *   subs
	 *     addr1: client1, client2
	 *     addr2: client1
	 *     xpub1: client1
	 *     xpub2: client2
	 *    xpub4: client3
	 *
	 *   client1: addr1, addr2, xpub1
	 *   client2: addr1, xpub2
	 *   client3: xpub4
	 *
	 *   tx -> client1
	 *     inputs
	 *       addr1
	 *     outputs
	 *       xpub1
	 *       addr2
	 *
	 *   tx -> client2
	 *     inputs
	 *       addr1
	 *       xpub2
	 *     outputs
	 *       xpub2
	 *
	 * @note Synchronous processing done by this method
	 * may become a bottleneck in the future if under heavy load.
	 * Split in multiple async calls might make sense.
	 */
	async notifyTransaction(txid?: string) {
		const tx = (await db.getTransaction(txid)) as unknown as NotificationTx;

		try {
			// Topics extracted from the transaction
			const topics: Record<string, true> = {};
			// Client subscriptions: {[cid]: [topic1, topic2, ...]}
			const clients: Record<number, string[]> = {};

			// Extract topics from the inputs
			for (const index in tx.inputs) {
				const input = tx.inputs[index];
				let topic: string | null = null;

				if (input.prev_out) {
					// Topic is either xpub or addr. Should it be both?
					if (input.prev_out.xpub) {
						topic = input.prev_out.xpub.m;
					} else if (input.prev_out.addr) {
						topic = input.prev_out.addr;
					}
				}

				if (topic && this.subs[topic]) {
					topics[topic] = true;
					// Add topic information to the input
					input.topic = topic;
				}
			}

			// Extract topics from the outputs
			for (const o in tx.out) {
				const output = tx.out[o];
				let topic: string | null = null;

				if (output.xpub) {
					topic = output.xpub.m;
				} else if (output.addr) {
					topic = output.addr;
				}

				if (topic && this.subs[topic]) {
					topics[topic] = true;
					// Add topic information to the output
					output.topic = topic;
				}
			}

			for (const topic in topics) {
				for (const cid of this.subs[topic]) {
					if (!clients[cid]) clients[cid] = [];
					if (!clients[cid].includes(topic)) clients[cid].push(topic);
				}
			}

			// Tailor a transaction for each client
			for (const cid in clients) {
				const context = cloneDeep(tx);
				context.inputs = [];
				context.out = [];

				// List of topics relevant to this client
				const clientTopics = clients[cid];

				// Check for topic information on inputs & outputs (added above)
				for (const input of tx.inputs) {
					const { topic } = input;
					if (topic && clientTopics.includes(topic)) {
						const cin = cloneDeep(input);
						delete cin.topic;
						if (this.cachePubKeys.has(topic))
							cin.pubkey = this.cachePubKeys.get(topic);
						context.inputs.push(cin);
					}
				}

				for (const output of tx.out) {
					const { topic } = output;
					if (topic && clientTopics.includes(topic)) {
						const cout = cloneDeep(output);
						delete cout.topic;
						if (this.cachePubKeys.has(topic))
							cout.pubkey = this.cachePubKeys.get(topic);
						context.out.push(cout);
					}
				}

				// Move on if the custom transaction has no inputs or outputs
				if (context.inputs.length === 0 && context.out.length === 0) continue;

				// Send custom transaction to client
				const data = {
					op: "utx",
					x: context,
				};

				try {
					this.conn[cid].send(JSON.stringify(data));
					debug &&
						Logger.error(
							null,
							`API : Sent ctx ${context.hash} to client ${cid}`,
						);
				} catch (error) {
					Logger.error(
						error,
						`API : NotificationsService.notifyTransaction() : Trouble sending ctx to client ${cid}`,
					);
				}
			}
		} catch (error) {
			Logger.error(error, "API : NotificationsService.notifyTransaction()");
		}
	}

	/**
	 * Dispatch notification for an authentication error
	 */
	notifyAuthError(error: unknown, cid: number) {
		const data = {
			op: "error",
			msg: error,
		};

		try {
			this.conn[cid].send(JSON.stringify(data));
			debug &&
				Logger.error(null, `API : Sent authentication error to client ${cid}`);
		} catch (error) {
			Logger.error(
				error,
				`API : NotificationsService.notifyAuthError() : Trouble sending authentication error to client ${cid}`,
			);
		}
	}
}

export default NotificationsService;

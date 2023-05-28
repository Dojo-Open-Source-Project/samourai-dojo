/*!
 * accounts/notification-web-sockets.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import cloneDeep from 'lodash.clonedeep'
import QuickLRU from 'quick-lru'
import WebSocket from 'websocket'

import db from '../lib/db/mysql-db-wrapper.js'
import Logger from '../lib/logger.js'
import apiHelper from './api-helper.js'
import status from './status.js'
import authMgr from '../lib/auth/authorizations-manager.js'

const debug = process.argv.includes('ws-debug')


/**
 * A class providing a notifications server over web sockets
 */
class NotificationsService {

    /**
     * Constructor
     * @param {object} server - listening instance of a http server
     */
    constructor(server) {
        // Web sockets server
        this.ws = null
        // Dictionary of connections
        this.conn = {}
        // Dictionary of subscriptions
        this.subs = {}
        // Dictionary mapping addresses to pubkeys
        this.cachePubKeys = new Map()

        // Cache registering the most recent subscriptions received
        // Used to filter multiple subscriptions sent by external apps.
        this.cacheSubs = new QuickLRU({
            // Maximum number of subscriptions to store in cache
            // Estimate: 1000 clients with an average of 5 subscriptions
            maxSize: 5000,
            // Maximum age for items in the cache (1mn)
            maxAge: 60 * 1000
        })

        // Initialize the web socket server
        this._initWSServer(server)
    }

    /**
     * Initialize the web sockets server
     * @param {object} server - listening instance of a http server
     */
    _initWSServer(server) {
        this.ws = new WebSocket.server({ httpServer: server })

        Logger.info('API : Created WebSocket server')

        this.ws.on('request', request => {
            try {
                let conn = request.accept(null, request.origin)
                conn.id = status.sessions++
                conn.subs = []

                debug && Logger.info(`API : Client ${conn.id} connected`)

                conn.on('close', () => {
                    this._closeWSConnection(conn, false)
                })

                conn.on('error', error => {
                    Logger.error(error, `API : NotificationsService : Error on connection ${conn.id}`)
                    if (conn.connected)
                        this._closeWSConnection(conn, true)
                })

                conn.on('message', message => {
                    if (message.type === 'utf8')
                        this._handleWSMessage(message.utf8Data, conn)
                    else
                        this._closeWSConnection(conn, true)
                })

                this.conn[conn.id] = conn
                status.clients = status.clients + 1
                status.maxConn = Math.max(status.maxConn, Object.keys(this.conn).length)

            } catch (error) {
                Logger.error(error, 'API : NotificationsService._initWSServer() : Error during request accept')
            }
        })
    }

    /**
     * Close a web sockets connection
     * @param {object} conn - web socket connection
     * @param {boolean} forcedClose - true if close initiated by server
     */
    _closeWSConnection(conn, forcedClose) {
        try {
            for (let topic of conn.subs) {
                this._unsub(topic, conn.id)

                // Close initiated by client, remove subscriptions from cache
                if (!forcedClose && this.cacheSubs.has(topic))
                    this.cacheSubs.delete(topic)
            }

            if (this.conn[conn.id]) {
                delete this.conn[conn.id]
                status.clients = status.clients - 1
            }

            // Close initiated by server, drop the connection
            if (forcedClose && conn.connected)
                conn.drop(1008, 'Get out of here!')

            debug && Logger.info(`API : Client ${conn.id} disconnected`)

        } catch (error) {
            Logger.error(error, 'API : NotificationsService._closeWSConnection()')
        }
    }

    /**
     * Filter potential duplicate subscriptions
     * @param {string} msg - subscription received
     * @returns {boolean} returns false if it's a duplicate, true otherwise.
     */
    _filterWSMessage(msg) {
        if (this.cacheSubs.has(msg)) {
            debug && Logger.info('API : Duplicate subscriptions detected')
            return false
        } else {
            this.cacheSubs.set(msg, true)
            return true
        }
    }

    /**
     * Handle messages received over the web sockets
     * (subscriptions)
     * @param {string} msg - subscription received
     * @param {object} conn - connection
     */
    _handleWSMessage(msg, conn) {
        try {
            debug && Logger.info(`API : Received from client ${conn.id}: ${msg}`)

            const data = JSON.parse(msg)

            // Check authentication (if needed)
            if (authMgr.authActive && authMgr.isMandatory) {
                try {
                    authMgr.isAuthenticated(data.at)
                } catch (error) {
                    this.notifyAuthError(error, conn.id)
                    return
                }
            }

            switch (data.op) {
            case 'ping':
                conn.sendUTF('{"op": "pong"}')
                break
            case 'addr_sub':
                if (data.addr) {
                    // Check for potential flood by clients
                    // subscribing for the same xpub again and again
                    if (this._filterWSMessage(data.addr))
                        this._entitysub(data.addr, conn)
                    else
                        this._closeWSConnection(conn, true)
                }
                break
            case 'blocks_sub':
                this._addsub('block', conn)
                break
            }
        } catch (error) {
            Logger.error(error, 'API : NotificationsService._handleWSMessage() : WebSocket message error')
        }
    }

    /**
     * Subscribe to a list of addresses/xpubs/pubkeys
     * @param {string} topic - topic
     * @param {object} conn - connection asking for subscription
     */
    _entitysub(topic, conn) {
        const valid = apiHelper.parseEntities(topic)

        for (let a in valid.addrs) {
            const address = valid.addrs[a]
            this._addsub(address, conn)
            if (valid.pubkeys[a]) {
                this.cachePubKeys.set(address, valid.pubkeys[a])
            }
        }

        for (let xpub of valid.xpubs)
            this._addsub(xpub, conn)
    }

    /**
     * Subscribe to a topic
     * @param {string} topic - topic
     * @param {object} conn - connection asking for subscription
     */
    _addsub(topic, conn) {
        if (conn.subs.includes(topic))
            return false

        conn.subs.push(topic)

        if (!this.subs[topic])
            this.subs[topic] = []

        this.subs[topic].push(conn.id)

        debug && Logger.info(`API : Client ${conn.id} subscribed to ${topic}`)
    }

    /**
     * Unsubscribe from a topic
     * @param {string} topic - topic
     * @param {number} cid - client id
     */
    _unsub(topic, cid) {
        if (!this.subs[topic])
            return false

        const index = this.subs[topic].indexOf(cid)
        if (index < 0)
            return false

        this.subs[topic].splice(index, 1)

        if (this.subs[topic].length === 0) {
            delete this.subs[topic]
            if (this.cachePubKeys.has(topic))
                this.cachePubKeys.delete(topic)
        }

        return true
    }

    /**
     * Dispatch a notification to all clients
     * who have subscribed to a topic
     * @param {string} topic - topic
     * @param {string} msg - content of the notification
     */
    dispatch(topic, msg) {
        if (!this.subs[topic])
            return

        for (let cid of this.subs[topic]) {
            if (!this.conn[cid])
                continue

            try {
                this.conn[cid].sendUTF(msg)
            } catch (error) {
                Logger.error(error, `API : NotificationsService.dispatch() : Error sending dispatch for ${topic} to client ${cid}`)
            }
        }
    }

    /**
     * Dispatch notifications for a new block
     * @param {{ height: number, hash: string}} block - block hash and height
     */
    notifyBlock({ height, hash }) {
        try {
            const data = {
                op: 'block',
                x: {
                    height: height,
                    hash: hash
                }
            }
            this.dispatch('block', JSON.stringify(data))
        } catch (error) {
            Logger.error(error, 'API : NotificationsService.notifyBlock()')
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
     * @param {string} txid - transaction
     *
     * @note Synchronous processing done by this method
     * may become a bottleneck in the future if under heavy load.
     * Split in multiple async calls might make sense.
     */
    async notifyTransaction(txid) {
        const tx = await db.getTransaction(txid)

        try {
            // Topics extracted from the transaction
            const topics = {}
            // Client subscriptions: {[cid]: [topic1, topic2, ...]}
            const clients = {}

            // Extract topics from the inputs
            for (let index in tx.inputs) {
                let input = tx.inputs[index]
                let topic = null

                if (input.prev_out) {
                    // Topic is either xpub or addr. Should it be both?
                    if (input.prev_out.xpub) {
                        topic = input.prev_out.xpub.m
                    } else if (input.prev_out.addr) {
                        topic = input.prev_out.addr
                    }
                }

                if (this.subs[topic]) {
                    topics[topic] = true
                    // Add topic information to the input
                    input.topic = topic
                }
            }

            // Extract topics from the outputs
            for (let o in tx.out) {
                let output = tx.out[o]
                let topic = null

                if (output.xpub) {
                    topic = output.xpub.m
                } else if (output.addr) {
                    topic = output.addr
                }

                if (this.subs[topic]) {
                    topics[topic] = true
                    // Add topic information to the output
                    output.topic = topic
                }
            }

            for (let topic in topics) {
                for (let cid of this.subs[topic]) {
                    if (!clients[cid])
                        clients[cid] = []
                    if (!clients[cid].includes(topic))
                        clients[cid].push(topic)
                }
            }

            // Tailor a transaction for each client
            for (let cid in clients) {
                const context = cloneDeep(tx)
                context.inputs = []
                context.out = []

                // List of topics relevant to this client
                const clientTopics = clients[cid]

                // Check for topic information on inputs & outputs (added above)
                for (let input of tx.inputs) {
                    const {topic} = input
                    if (topic && clientTopics.includes(topic)) {
                        const cin = cloneDeep(input)
                        delete cin.topic
                        if (this.cachePubKeys.has(topic))
                            cin.pubkey = this.cachePubKeys.get(topic)
                        context.inputs.push(cin)
                    }
                }

                for (let output of tx.out) {
                    const {topic} = output
                    if (topic && clientTopics.includes(topic)) {
                        const cout = cloneDeep(output)
                        delete cout.topic
                        if (this.cachePubKeys.has(topic))
                            cout.pubkey = this.cachePubKeys.get(topic)
                        context.out.push(cout)
                    }
                }

                // Move on if the custom transaction has no inputs or outputs
                if (context.inputs.length === 0 && context.out.length === 0)
                    continue

                // Send custom transaction to client
                const data = {
                    op: 'utx',
                    x: context
                }

                try {
                    this.conn[cid].sendUTF(JSON.stringify(data))
                    debug && Logger.error(null, `API : Sent ctx ${context.hash} to client ${cid}`)
                } catch (error) {
                    Logger.error(error, `API : NotificationsService.notifyTransaction() : Trouble sending ctx to client ${cid}`)
                }
            }

        } catch (error) {
            Logger.error(error, 'API : NotificationsService.notifyTransaction()')
        }
    }

    /**
     * Dispatch notification for an authentication error
     * @param {string} error - error
     * @param {number} cid - connection id
     */
    notifyAuthError(error, cid) {
        const data = {
            op: 'error',
            msg: error
        }

        try {
            this.conn[cid].sendUTF(JSON.stringify(data))
            debug && Logger.error(null, `API : Sent authentication error to client ${cid}`)
        } catch (error) {
            Logger.error(error, `API : NotificationsService.notifyAuthError() : Trouble sending authentication error to client ${cid}`)
        }
    }


}

export default NotificationsService

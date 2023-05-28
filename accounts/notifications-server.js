/*!
 * accounts/notification-web-sockets.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import zmq from 'zeromq/v5-compat.js'
import Logger from '../lib/logger.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import NotificationsService from './notifications-service.js'

const keys = keysFile[network.key]

/**
 * A singleton providing a notifications server over web sockets
 */
class NotificationsServer {

    constructor() {
        // Http server
        this.httpServer = null
        // Notifications service
        this.notifService = null
    }

    /**
     * Attach the web sockets server to the listening web server
     * @param {HttpServer} httpServer - HTTP server
     */
    attach(httpServer) {
        this.httpServer = httpServer

        if (this.notifService !== null) return

        this.notifService = new NotificationsService(httpServer.server)

        // Initialize the zmq socket for communications
        // with the tracker
        this._initTrackerSocket()
    }


    /**
     * Initialize a zmq socket for notifications from the tracker
     * @private
     */
    _initTrackerSocket() {
        this.sock = zmq.socket('sub')
        this.sock.connect(`tcp://127.0.0.1:${keys.ports.tracker}`)
        this.sock.subscribe('block')
        this.sock.subscribe('transaction')

        this.sock.on('message', async (topic, message) => {
            switch (topic.toString()) {
            case 'block':
                try {
                    const block = JSON.parse(message.toString())
                    this.notifService.notifyBlock(block)
                } catch (error) {
                    Logger.error(error, 'API : NotificationServer._initTrackerSocket() : Error in block message')
                }
                break
            case 'transaction':
                try {
                    const txid = message.toString()
                    await this.notifService.notifyTransaction(txid)
                } catch (error) {
                    Logger.error(error, 'API : NotificationServer._initTrackerSocket() : Error in transaction message')
                }
                break
            default:
                Logger.info(`API : Unknown ZMQ message topic: "${topic}"`)
            }
        })
    }

    /**
     * Close existing ZMQ connection
     */
    close() {
        this.sock && this.sock.close()
    }

}

export default new NotificationsServer()

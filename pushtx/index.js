/*!
 * pushtx/index.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import Logger from '../lib/logger.js'
import db from '../lib/db/mysql-db-wrapper.js'
import { waitForBitcoindRpcApi } from '../lib/bitcoind-rpc/rpc-client.js'
import sorobanUtil from '../lib/soroban/util.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import HttpServer from '../lib/http-server/http-server.js'
import PushTxRestApi from './pushtx-rest-api.js'
import PandoTxProcessor from './pandotx-processor.js'
import pushTxProcessor from './pushtx-processor.js'


const keys = keysFile[network.key]


try {
    /**
     * PushTx API
     */
    Logger.info(`PushTx : Process ID: ${process.pid}`)
    Logger.info('PushTx : Preparing the pushTx API')

    // Wait for Bitcoind RPC API
    // being ready to process requests
    await waitForBitcoindRpcApi()

    if (keys.pandoTx?.push === 'active') {
        // Wait for Soroban RPC API
        // being ready to process requests
        await sorobanUtil.waitForSorobanRpcApi()
    }

    // Initialize the db wrapper
    const dbConfig = {
        connectionLimit: keys.db.connectionLimitPushTxApi,
        acquireTimeout: keys.db.acquireTimeout,
        host: keys.db.host,
        user: keys.db.user,
        password: keys.db.pass,
        database: keys.db.database
    }

    db.connect(dbConfig)

    // Initialize and start the orchestrator
    const pandoTxProcessor = new PandoTxProcessor()
    pandoTxProcessor.start()

    // Initialize notification sockets of singleton pushTxProcessor
    pushTxProcessor.initNotifications({
        uriSocket: `tcp://127.0.0.1:${keys.ports.notifpushtx}`
    })
    pushTxProcessor.start()

    // Initialize the http server
    const host = keys.apiBind
    const port = keys.ports.pushtx
    const httpServer = new HttpServer(port, host)

    // Initialize the PushTx rest api
    new PushTxRestApi(httpServer)

    // Start the http server
    httpServer.start()

    // Signal that the process is ready
    process.send('ready')

    const exit = async () => {
        httpServer.stop()
        pandoTxProcessor.stop()
        await Promise.all([pushTxProcessor.stop(), db.disconnect()])
        process.exit(0)
    }

    process.on('SIGTERM', async () => {
        await exit()
    })

    process.on('SIGINT', async () => {
        await exit()
    })

} catch (error) {
    Logger.error(error, 'PushTx : Unhandled error, exiting...')
    process.exit(1)
}

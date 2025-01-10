/*!
 * pushtx/index.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { RPC } from 'soroban-client-nodejs'
import Logger from '../lib/logger.js'
import db from '../lib/db/mysql-db-wrapper.js'
import { waitForBitcoindRpcApi } from '../lib/bitcoind-rpc/rpc-client.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import HttpServer from '../lib/http-server/http-server.js'
import util from '../lib/util.js'
import PushTxRestApi from './pushtx-rest-api.js'
import pushTxProcessor from './pushtx-processor.js'
import pandoTx from './pandotx-processor.js'


const keys = keysFile[network.key]


/**
 * Check if the Soroban rpc api is ready to process requests
 * @returns {Promise<void>}
 */
async function waitForSorobanRpcApi() {
    let sorobanRpc = null
    try {
        const sorobanUrl = keys['pandoTx']['sorobanUrl']
        const socks5ProxyUrl = (sorobanUrl.includes('.onion')) ?
            keys['pandoTx']['socks5Proxy'] :
            null
        sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl)
        const entries = await sorobanRpc.directoryList('test.start')
    } catch (e) {
        sorobanRpc = null
        Logger.info('PandoTx : Soroban RPC API is still unreachable. New attempt in 20s.')
        await util.delay(20000)
        return await waitForSorobanRpcApi()
    }
}


try {
    /**
     * PushTx API
     */
    Logger.info(`PushTx : Process ID: ${process.pid}`)
    Logger.info('PushTx : Preparing the pushTx API')

    // Wait for Bitcoind RPC API
    // being ready to process requests
    await waitForBitcoindRpcApi()

    // Wait for Soroban RPC API
    // being ready to process requests
    await waitForSorobanRpcApi()

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

    // Initialize notification sockets of singleton pushTxProcessor
    pushTxProcessor.initNotifications({
        uriSocket: `tcp://127.0.0.1:${keys.ports.notifpushtx}`
    })

    // Initialize the http server
    const host = keys.apiBind
    const port = keys.ports.pushtx
    const httpServer = new HttpServer(port, host)

    // Initialize the PushTx rest api
    new PushTxRestApi(httpServer)

    // Start the http server
    httpServer.start()

    // Start the processor
    pandoTx.start()
    Logger.info('PushTx : PandoTx processor started')

    // Signal that the process is ready
    process.send('ready')

    const exit = async () => {
        httpServer.stop()
        pandoTx.stop()
        await db.disconnect()
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

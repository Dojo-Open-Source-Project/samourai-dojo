/*!
 * pushtx/index-orchestrator.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import Logger from '../lib/logger.js'
import db from '../lib/db/mysql-db-wrapper.js'
import { waitForBitcoindRpcApi } from '../lib/bitcoind-rpc/rpc-client.js'
import sorobanUtil from '../lib/soroban/util.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import Orchestrator from './orchestrator.js'
import pushTxProcessor from './pushtx-processor.js'

const keys = keysFile[network.key]

try {
    /**
     * PushTx Orchestrator
     */
    Logger.info(`Orchestrator : Process ID: ${process.pid}`)
    Logger.info('Orchestrator : Preparing the pushTx Orchestrator')

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
        connectionLimit: keys.db.connectionLimitPushTxOrchestrator,
        acquireTimeout: keys.db.acquireTimeout,
        host: keys.db.host,
        user: keys.db.user,
        password: keys.db.pass,
        database: keys.db.database
    }

    db.connect(dbConfig)

    // Initialize notification sockets of singleton pushTxProcessor
    pushTxProcessor.initNotifications({
        uriSocket: `tcp://127.0.0.1:${keys.ports.orchestrator}`
    })
    pushTxProcessor.start()

    // Initialize and start the orchestrator
    const orchestrator = new Orchestrator()
    await orchestrator.start()

    // Signal that the process is ready
    process.send('ready')

    const exit = async () => {
        await Promise.all([
            pushTxProcessor.stop(),
            orchestrator.stop(),
            db.disconnect()
        ])
        process.exit(0)
    }

    process.on('SIGTERM', async () => {
        await exit()
    })

    process.on('SIGINT', async () => {
        await exit()
    })

} catch (error) {
    Logger.error(error, 'Orchestrator : Unhandled error, exiting...')
    process.exit(1)
}

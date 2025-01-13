/*!
 * pushtx/index-pandotx.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import Logger from '../lib/logger.js'
import { waitForBitcoindRpcApi } from '../lib/bitcoind-rpc/rpc-client.js'
import sorobanUtil from '../lib/soroban/util.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import PandoTxProcessor from './pandotx-processor.js'
import pushTxProcessor from './pushtx-processor.js'


const keys = keysFile[network.key]

try {
    /**
     * PandoTx Processor
     */
    Logger.info(`PandoTx Processor : Process ID: ${process.pid}`)
    Logger.info('PandoTx Processor : Preparing the Processor')

    // Wait for Bitcoind RPC API
    // being ready to process requests
    await waitForBitcoindRpcApi()

    if (keys['pandoTx']['process'] == 'active') {
        // Wait for Soroban RPC API
        // being ready to process requests
        await sorobanUtil.waitForSorobanRpcApi()
    }

    // Initialize notification sockets of singleton pushTxProcessor
    pushTxProcessor.initNotifications({
        uriSocket: `tcp://127.0.0.1:${keys.ports.pandoTx}`
    })
    pushTxProcessor.start()

    // Initialize and start the orchestrator
    const pandoTxProcessor = new PandoTxProcessor()
    pandoTxProcessor.start()

    // Signal that the process is ready
    process.send('ready')

    const exit = async () => {
        pushTxProcessor.stop()
        pandoTxProcessor.stop()
        process.exit(0)
    }

    process.on('SIGTERM', async () => {
        await exit()
    })

    process.on('SIGINT', async () => {
        await exit()
    })

} catch (error) {
    Logger.error(error, 'PandoTx Processor : Unhandled error, exiting...')
    process.exit(1)
}

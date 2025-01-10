/*!
 * pushtx/index-pandotx.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */
import { RPC } from 'soroban-client-nodejs'
import keysFile from '../keys/index.js'
import network from '../lib/bitcoin/network.js'
import { waitForBitcoindRpcApi } from '../lib/bitcoind-rpc/rpc-client.js'
import Logger from '../lib/logger.js'
import util from '../lib/util.js'
import PandoTxProcessor from './pandotx-processor.js'


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
     * PandoTx Processor
     */
    Logger.info(`PandoTx : Process ID: ${process.pid}`)
    
    Logger.info('PandoTx : Preparing the PandoTx Processor')

    // Wait for Bitcoind RPC API
    // being ready to process requests
    await waitForBitcoindRpcApi()

    // Wait for Soroban RPC API
    // being ready to process requests
    await waitForSorobanRpcApi()

   // Initialize and start the processor
    const processor = new PandoTxProcessor()
    processor.start()

    Logger.info('PandoTx : Processor started')

    // Signal that the process is ready
    process.send('ready')

    const exit = async () => {
        processor.stop()
        process.exit(0)
    }

    process.on('SIGTERM', async () => {
        await exit()
    })

    process.on('SIGINT', async () => {
        await exit()
    })

} catch (error) {
    Logger.error(error, 'PandoTx : Unhandled error, exiting...')
    process.exit(1)
}
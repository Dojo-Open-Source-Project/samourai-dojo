/*!
 * lib/bitcoind-rpc/fees.js
 * Copyright © 2023 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { FeeEstimator } from '@samouraiwallet/one-dollar-fee-estimator'

import { waitForBitcoindRpcApi } from '../lib/bitcoind-rpc/rpc-client.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import Logger from '../lib/logger.js'

const keys = keysFile[network.key]

try {
    await waitForBitcoindRpcApi()

    const estimator = new FeeEstimator({
        mode: 'txs',
        refresh: 20,
        rpcOptions: {
            host: keys.bitcoind.rpc.host,
            port: keys.bitcoind.rpc.port,
            username: keys.bitcoind.rpc.user,
            password: keys.bitcoind.rpc.pass,
        }
    })

    // handle errors emitted by FeeEstimator
    estimator.on('error', (error) => {
        Logger.error(error, 'Estimator : Received estimator error')
    })

    // receive live fee rate updates from the FeeEstimator
    estimator.on('data', (result) => {
        if (result.ready === false) Logger.info('Estimator : Mempool not fully loaded. Feerates might be unreliable.')
        Logger.info(`Estimator : Received new fee estimates: ${JSON.stringify(result.fees)}`)
        process.send({
            type: 'process:msg',
            data: {
                topic: 'fee-estimator',
                value: result
            }
        })
    })

    // Signal that the process is ready
    process.send('ready')

    const exit = () => {
        estimator.stop()
        process.exit(0)
    }

    process.on('SIGTERM', () => {
        exit()
    })

    process.on('SIGINT', () => {
        exit()
    })
} catch (error) {
    Logger.error(error, 'Estimator : Unhandled error, exiting...')
    process.exit(1)
}

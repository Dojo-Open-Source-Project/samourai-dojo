/*!
 * lib/bitcoind_rpc/rpc-client.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import { RPCClient } from 'rpc-bitcoin'

import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import util from '../util.js'
import Logger from '../logger.js'

const keys = keysFile[network.key]

/**
 * @typedef {import('rpc-bitcoin').RPCIniOptions} RPCIniOptions
 */

/**
 * Wrapper for bitcoind rpc client
 * @param {RPCIniOptions=} options
 * @returns {RPCClient}
 */
export const createRpcClient = (options = {}) => {
    return new RPCClient({
        url: `http://${keys.bitcoind.rpc.host}`,
        port: keys.bitcoind.rpc.port,
        user: keys.bitcoind.rpc.user,
        pass: keys.bitcoind.rpc.pass,
        timeout: 2 * 60 * 1000, // 2 minutes
        ...options
    })
}

/**
 * Check if an error returned by bitcoin-rpc-client
 * is a connection error.
 * @param {string} error - error message
 * @returns {boolean} returns true if message related to a connection error
 */
export const isConnectionError = (error) => {
    if (typeof error !== 'string')
        return false

    const isTimeoutError = (error.includes('connect ETIMEDOUT'))
    const isConnRejected = (error.includes('Connection Rejected'))

    return (isTimeoutError || isConnRejected)
}

/**
 * Check if the rpc api is ready to process requests
 * @returns {Promise<void>}
 */
export const waitForBitcoindRpcApi = async () => {
    let client = createRpcClient()

    try {
        const networkInfo = await client.getnetworkinfo()

        if (networkInfo.subversion.includes('Knots')) {
            Logger.error(null, `Unsupported Bitcoin client detected: ${networkInfo.subversion}. Exiting...`)
            process.exit(0)
        }
    } catch {
        client = null
        Logger.info('Bitcoind RPC : API is still unreachable. New attempt in 20s.')
        await util.delay(20000)
        return await waitForBitcoindRpcApi()
    }
}

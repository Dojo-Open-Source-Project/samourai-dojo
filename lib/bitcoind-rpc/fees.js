/*!
 * lib/bitcoind-rpc/fees.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { execSync } from 'child_process'
import path from 'path'

import errors from '../errors.js'
import Logger from '../logger.js'
import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import { createRpcClient, waitForBitcoindRpcApi } from './rpc-client.js'
import latestBlock from './latest-block.js'

const keys = keysFile[network.key]

/**
 * @typedef {import('@samouraiwallet/one-dollar-fee-estimator/dist/types').Result} EstimatorData
 */

/**
 * A singleton providing information about network fees
 */
class Fees {

    constructor() {
        this.block = -1
        this.fees = {
            2: 1,
            4: 1,
            6: 1,
            12: 1,
            24: 1
        }
        /**
         * @type {EstimatorData}
         */
        this.estimatorData = {
            ready: false,
            fees: {
                '0.1': 1,
                '0.2': 1,
                '0.5': 1,
                '0.9': 1,
                '0.99': 1,
                '0.999': 1,
            }
        }
        this.feeType = keys.bitcoind.feeType
        this.timer = null

        this.rpcClient = createRpcClient()

        waitForBitcoindRpcApi().then(() => {
            this.refresh()
        })

        this.initIpc()
    }

    /**
     * Async function to initialize inter-process communication for cases where accounts process is running in cluster mode
     * @returns {Promise<void>}
     */
    async initIpc() {
        try {
            const NpmRoot = execSync('npm root -g').toString('utf8')
            const pm2Module = await import(path.join(NpmRoot, 'pm2', 'index.js'))
            const pm2 = pm2Module.default

            pm2.launchBus((error, pm2_bus) => {
                if (error) {
                    Logger.error(error, 'Fees : PM2 launchbus failed')
                    return
                }

                pm2_bus.on('process:msg', (packet) => {
                    const data = packet.data
                    if (data && data.topic === 'fee-estimator') {
                        this.estimatorData = data.value
                    }
                })
            })
        } catch (error) { // allowed to fail
            Logger.error(error, 'Fees : IPC initialization failed')
        }
    }

    /**
     * Refresh and return the current fees
     * @returns {Promise<object>}
     */
    async getFees() {
        try {
            if (latestBlock.height > this.block)
                await this.refresh()

            return this.fees

        } catch {
            throw errors.generic.GEN
        }
    }

    /**
     * Get fee rates calculated by $1 Fee Estimator
     * @returns {EstimatorData.fees}
     * @throws {string} - Throw error if estimator hasn't sent any data or if bitcoind mempool isn't fully loaded
     */
    getEstimatorFees() {
        if (this.estimatorData.ready === false) throw errors.estimator.NOT_AVAILABLE

        return this.estimatorData.fees
    }

    /**
     * Refresh the current fees
     * @returns {Promise<void>}
     */
    async refresh() {
        clearTimeout(this.timer)

        try {
            const requests = Object.keys(this.fees).map(Number).map((target) => {
                return { method: 'estimatesmartfee', params: { conf_target: target, estimate_mode: this.feeType }, id: target }
            })
            const responses = await this.rpcClient.batch(requests)

            for (const fee of responses) {
                const feerate = (fee.result.errors && fee.result.errors.length > 0) ? 1 : Math.round(fee.result.feerate * 1e5)
                // add 1 to feerate if the feerate is larger than 1 to avoid underpaying
                this.fees[fee.id] = feerate === 1 ? feerate : feerate + 1
            }
        } catch (error) {
            Logger.error(error, 'Bitcoind RPC : Fees.refresh()')
        }
        this.block = latestBlock.height
        // Make this method refresh fees at least every minute
        this.timer = setTimeout(() => this.refresh(), 60000) // 1 MINUTE
    }

}

export default new Fees()

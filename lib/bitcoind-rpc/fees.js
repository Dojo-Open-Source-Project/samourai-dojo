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
 * A singleton providing information about network fees
 */
class Fees {

    constructor() {
        this.block = -1
        this.targets = [2, 4, 6, 12, 24]
        this.fees = {
            2: 0,
            4: 0,
            6: 0,
            12: 0,
            24: 0
        }
        this.estimatorFees = [1, 1, 1, 1]
        this.receivedEstimatorData = false
        this.feeType = keys.bitcoind.feeType

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
                        this.receivedEstimatorData = true
                        this.estimatorFees = data.value
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
     * @returns {readonly [number, number, number, number]}
     */
    getEstimatorFees() {
        if (this.receivedEstimatorData === false) throw errors.estimator.NOT_AVAILABLE

        return this.estimatorFees
    }

    /**
     * Refresh the current fees
     * @returns {Promise<void>}
     */
    async refresh() {
        try {
            const requests = this.targets.map((target) => {
                return { method: 'estimatesmartfee', params: { conf_target: target, estimate_mode: this.feeType }, id: target }
            })
            const responses = await this.rpcClient.batch(requests)

            for (const fee of responses) {
                this.fees[fee.id] = (fee.result.errors && fee.result.errors.length > 0) ? 0 : Math.round(fee.result.feerate * 1e5)
            }
        } catch (error) {
            Logger.error(error, 'Bitcoind RPC : Fees.refresh()')
        }
        this.block = latestBlock.height
    }

}

export default new Fees()

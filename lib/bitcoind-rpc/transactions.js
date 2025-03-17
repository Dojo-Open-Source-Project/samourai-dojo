/*!
 * lib/bitcoind-rpc/transactions.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import QuickLRU from 'quick-lru'

import errors from '../errors.js'
import Logger from '../logger.js'
import util from '../util.js'
import { createRpcClient } from './rpc-client.js'
import rpcLatestBlock from './latest-block.js'


/**
 * A singleton providing information about transactions
 */
class Transactions {

    constructor() {
        // Caches
        this.prevCache = new QuickLRU({
            // Maximum number of transactions to store
            maxSize: 20000,
            // Maximum age for items in the cache.
            maxAge: 1000 * 60 * 60 * 24 * 2 // two days
        })


        // Initialize the rpc client
        this.rpcClient = createRpcClient()
    }

    /**
     * Get the transactions for a given array of txids
     * @param {string[]} txids - txids of the transaction to be retrieved
     * @param {boolean} fees - true if fees must be computed, false otherwise
     * @returns {Promise<object[]>} return an array of transactions (object[])
     */
    async getTransactions(txids, fees) {
        try {
            const rpcCalls = txids.map((txid, index) => {
                return {
                    method: 'getrawtransaction',
                    params: {
                        txid,
                        verbose: true
                    },
                    id: index
                }
            })

            const txs = await this.rpcClient.batch(rpcCalls)

            return await util.parallelCall(txs, async tx => {
                if (tx.result == null) {
                    Logger.info(`Bitcoind RPC :  got null for ${txids[tx.id]}`)
                    return null
                } else {
                    return this._prepareTxResult(tx.result, {fees})
                }
            })

        } catch (error) {
            Logger.error(error, 'Bitcoind RPC : Transaction.getTransactions()')
            throw errors.generic.GEN
        }
    }

    /**
     * Get the transaction for a given txid
     * @param {string} txid - txid of the transaction to be retrieved
     * @param {object} [options] - options
     * @param {boolean} [options.fees] - true if fees must be computed, false otherwise
     * @param {boolean} [options.rawHex] - true if raw hex must be included, false otherwise
     * @returns {Promise<object>}
     */
    async getTransaction(txid, {fees, rawHex} = {}) {
        try {
            const tx = await this.rpcClient.getrawtransaction({ txid, verbose: true })
            return this._prepareTxResult(tx, {fees, rawHex})
        } catch (error) {
            Logger.error(error, 'Bitcoind RPC : Transaction.getTransaction()')
            throw errors.generic.GEN
        }
    }

    /**
     * Get the raw transaction hex for a given txid
     * @param {string} txid - txid of the transaction to be retrieved
     * @returns {Promise<string>}
     */
    async getTransactionHex(txid) {
        try {
            const txHex = await this.rpcClient.getrawtransaction({ txid, verbose: false })
            return txHex
        } catch (error) {
            Logger.error(error, 'Bitcoind RPC : Transaction.getTransactionHex()')
            throw errors.generic.GEN
        }
    }

    /**
     * Formats a transaction object returned by the RPC API
     * @param {object} tx - transaction
     * @param {object} [options] - options
     * @param {boolean} [options.fees] - true if fees must be computed, false otherwise
     * @param {boolean} [options.rawHex] - true if raw hex must be included, false otherwise
     * @returns {Promise<object>} return a transaction object
     */
    async _prepareTxResult(tx, {fees , rawHex} = {}) {
        const returnValue = {
            txid: tx.txid,
            size: tx.size,
            version: tx.version,
            locktime: tx.locktime,
            inputs: [],
            outputs: []
        }

        if (tx.vsize) {
            returnValue.vsize = tx.vsize
        }

        if (tx.time) {
            returnValue.created = tx.time
        }

        if (tx.confirmations) {
            returnValue.confirmations = tx.confirmations
        }

        // Process block informations
        if (tx.blockhash && tx.confirmations && tx.blocktime) {
            returnValue.block = {
                height: rpcLatestBlock.height - tx.confirmations + 1,
                hash: tx.blockhash,
                time: tx.blocktime
            }
        }

        let inAmount = 0
        let outAmount = 0

        // Process the inputs
        returnValue.inputs = await this._getInputs(tx, fees)
        inAmount = returnValue.inputs.reduce((previous, current) => previous + current.outpoint.value, 0)

        // Process the outputs
        returnValue.outputs = this._getOutputs(tx)
        outAmount = returnValue.outputs.reduce((previous, current) => previous + current.value, 0)

        // Process the fees (if needed)
        if (fees) {
            returnValue.fees = inAmount - outAmount
            if (returnValue.fees > 0 && returnValue.size > 0)
                returnValue.feerate = Math.round(returnValue.fees / returnValue.size)
            if (returnValue.fees > 0 && returnValue.vsize)
                returnValue.vfeerate = Math.round(returnValue.fees / returnValue.vsize)
        }

        if (rawHex) {
            returnValue.hex = tx.hex
        }

        return returnValue
    }


    /**
     * Extract information about the inputs of a transaction
     * @param {object} tx - transaction
     * @param {boolean} fees - true if fees must be computed, false otherwise
     * @returns {Promise<object[]>} return an array of inputs (object[])
     */
    async _getInputs(tx, fees) {
        const inputs = []
        let n = 0

        await util.seriesCall(tx.vin, async input => {
            const txin = {
                n,
                seq: input.sequence,
            }

            if (input.coinbase) {
                txin.coinbase = input.coinbase
            } else {
                txin.outpoint = {
                    txid: input.txid,
                    vout: input.vout
                }
                txin.sig = input.scriptSig.hex
            }

            if (input.txinwitness)
                txin.witness = input.txinwitness

            if (fees && txin.outpoint) {
                const inTxid = txin.outpoint.txid
                let ptx

                if (this.prevCache.has(inTxid)) {
                    ptx = this.prevCache.get(inTxid)
                } else {
                    ptx = await this.rpcClient.getrawtransaction({ txid: inTxid, verbose: true })
                    this.prevCache.set(inTxid, ptx)
                }

                const outpoint = ptx.vout[txin.outpoint.vout]
                txin.outpoint.value = Math.round(outpoint.value * 1e8)
                txin.outpoint.scriptpubkey = outpoint.scriptPubKey.hex
                inputs.push(txin)
                n++

            } else {
                inputs.push(txin)
                n++
            }
        })

        return inputs
    }

    /**
     * Extract information about the outputs of a transaction
     * @param {object} tx - transaction
     * @returns {object[]} return an array of outputs (object[])
     */
    _getOutputs(tx) {
        const outputs = []
        let n = 0

        for (let output of tx.vout) {
            const pk = output.scriptPubKey
            const amount = Math.round(output.value * 1e8)

            let o = {
                n,
                value: amount,
                scriptpubkey: pk.hex,
                type: pk.type
            }

            if (pk.address) {
                o.address = pk.address
            }

            outputs.push(o)
            n++
        }

        return outputs
    }

}

export default new Transactions()

/*!
 * pushtx/pushtx-processor.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import bitcoin from 'bitcoinjs-lib'
import zmq from 'zeromq/v5-compat.js'

import Logger from '../lib/logger.js'
import errors from '../lib/errors.js'
import db from '../lib/db/mysql-db-wrapper.js'
import { createRpcClient } from '../lib/bitcoind-rpc/rpc-client.js'
import addrHelper from '../lib/bitcoin/addresses-helper.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import status from './status.js'
import PandoTxEmitter from './pandotx-emitter.js'


const keys = keysFile[network.key]

const SourcesFile = network.key === 'bitcoin'
    ? (await import('../lib/remote-importer/sources-mainnet.js'))
    : (await import('../lib/remote-importer/sources-testnet.js'))

const Sources = SourcesFile.default

/**
 * A singleton providing a wrapper
 * for pushing transactions with the local bitcoind
 */
class PushTxProcessor {

    constructor() {
        this.notifSock = null
        this.sources = new Sources()
        // Initialize the bitcoind rpc client
        this.rpcClient = createRpcClient()
        // Initialize the PandoTxEmitter
        this.pandoTxEmitter = new PandoTxEmitter()
    }

    /**
     * Initialize the sockets for notifications
     */
    initNotifications(config) {
        // Notification socket for the tracker
        this.notifSock = zmq.socket('pub')
        this.notifSock.bind(config.uriSocket)
    }

    /**
     * Enforce a strict verification mode on a list of outputs
     * @param {string} rawtx - raw bitcoin transaction in hex format
     * @param {number[]} vouts - output indices (integer)
     * @returns {number[]} returns the indices of the faulty outputs
     */
    async enforceStrictModeVouts(rawtx, vouts) {
        /** @type {number[]} */
        const faultyOutputs = []
        /** @type {Map<string, number>} */
        const addrMap = new Map()

        let tx
        try {
            tx = bitcoin.Transaction.fromHex(rawtx)
        } catch {
            throw errors.tx.PARSE
        }
        // Check in db if addresses are known and have been used
        // Check if TX contains outputs to duplicate address
        for (let vout of vouts) {
            if (vout >= tx.outs.length)
                throw errors.txout.VOUT
            const output = tx.outs[vout]
            const address = addrHelper.outputScript2Address(output.script)

            if (address) {
                const nbTxs = await db.getAddressNbTransactions(address)
                if (nbTxs == null || nbTxs > 0 || addrMap.has(address)) {
                    faultyOutputs.push(vout)
                } else {
                    addrMap.set(address, vout)
                }
            }
        }

        // Checks with indexer if addresses are known and have been used
        if (addrMap.size > 0 && keys.indexer.active !== 'local_bitcoind') {
            const results = await this.sources.getAddresses([...addrMap.keys()])

            for (let r of results) {
                if (r.ntx > 0) {
                    faultyOutputs.push(addrMap.get(r.address))
                }
            }
        }
        return faultyOutputs
    }

    /**
     * Push transactions to the Bitcoin network
     * @param {string} rawtx - raw bitcoin transaction in hex format
     * @param {boolean} forceLocalPush - force a push through the local bitcoind
     * @returns {string} returns the txid of the transaction
     */
    async pushTx(rawtx, forceLocalPush=false) {
        let value = 0

        // Attempt to parse incoming TX hex as a bitcoin Transaction
        try {
            const tx = bitcoin.Transaction.fromHex(rawtx)
            for (let output of tx.outs)
                value += output.value
            Logger.info(`PushTx : Push for ${(value / 1e8).toFixed(8)} BTC`)
        } catch {
            throw errors.tx.PARSE
        }

        // At this point, the raw hex parses as a legitimate transaction.
        let txid = null
        try {
            if ((keys['pandoTx']['push'] === 'active') && !forceLocalPush) {
                // Attempt to send via PandoTx (Soroban)
                txid = await this.pandoTxEmitter.emit(rawtx)
                Logger.info(`PandoTx : Pushed!`)
            } else {
                // Attempt to send via RPC to the bitcoind instance
                txid = await this.rpcClient.sendrawtransaction({ hexstring: rawtx })
                Logger.info('PushTx : Pushed!')
            }
            // Update the stats
            status.updateStats(value)
            // Notify the tracker
            this.notifSock.send(['pushtx', rawtx])
            return txid
        } catch (error) {
            Logger.info('PushTx : Push failed')
            throw error
        }
    }

}

export default new PushTxProcessor()

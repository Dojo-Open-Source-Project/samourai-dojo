/*!
 * pushtx/pandotx-processor.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */
import QuickLRU from 'quick-lru'
import bitcoin from 'bitcoinjs-lib'
import { RPC } from 'soroban-client-nodejs'
import rpcTxns from '../lib/bitcoind-rpc/transactions.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import errors from '../lib/errors.js'
import Logger from '../lib/logger.js'
import pushTxProcessor from './pushtx-processor.js'


const keys = keysFile[network.key]



/**
 * A class processing the push of transactions received through PandoTx
 */
class PandoTxProcessor {

    constructor() {
        this.checkProcessTxs = null
        
        // Check if processor is active
        if (keys['pandoTx']['process'] == 'inactive') {
            return
        }
        
        this.keyPush = keys['pandoTx']['keyPush']
        this.keyResults = keys['pandoTx']['keyResults']

        const sorobanUrl = keys['pandoTx']['sorobanUrl']
        const socks5ProxyUrl = (sorobanUrl.includes('.onion')) ?
            keys['pandoTx']['socks5Proxy'] :
            null
        this.sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl)

        this.txsCache = new QuickLRU({
            maxSize: 100,
            maxAge: 1000 * 60 * 60 // one hour
        })
    }

    /**
     * Start the processor
     * @returns {Promise}
     */
    start() {
        if (keys['pandoTx']['process'] == 'inactive') {
            Logger.info('PandoTx : Processor is inactive')
        } else {
            Logger.info('PandoTx : Processor started')
        }

        this.checkProcessTxs = setInterval(
            () => this.processTxs(),
            500
        )
    }

    /**
     * Stop the processor
     */
    async stop() {
        clearInterval(this.checkProcessTxs)
    }

    /**
     * Process the transactions received through PandoTx
     */
    async processTxs() {
        try {
            // Check if processor is active
            if (keys['pandoTx']['process'] == 'inactive') {
                return
            }

            const entries = await this.sorobanRpc.directoryList(this.keyPush)

            entries.forEach(async rawTx => {
                // Attempt to parse incoming string 
                // as a bitcoin transaction in hex format
                let tx = null
                try {
                    tx = bitcoin.Transaction.fromHex(rawTx)
                } catch {
                    Logger.error(`PandoTx : Error while parsing transaction ${rawTx}`)
                    throw errors.tx.PARSE
                }
                // Get the TXID of the transaction
                const txid = tx.getId()
                // Check if transaction has already been processed
                if (this.txsCache.has(txid)) {
                    return
                }
                // Check if transaction is known by the node
                try {
                    await rpcTxns.getTransactionHex(txid)
                    return
                } catch (e) {
                    // Transaction not found in mempool
                    // We can proceed further
                }
                // Push the transaction to bitcoind
                try {
                    const res = await pushTxProcessor.pushTx(rawTx, true)
                    this.txsCache.set(txid, true)
                    // Notify successfull push
                    await this.sorobanRpc.directoryAdd(this.keyResults, txid, 'short')
                } catch (e) {
                    throw e
                }
            })
        } catch (e) {
            throw e
        }
    }

}

export default PandoTxProcessor

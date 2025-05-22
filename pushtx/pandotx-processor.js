/*!
 * pushtx/pandotx-processor.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */
import QuickLRU from 'quick-lru'
import bitcoin from 'bitcoinjs-lib'
import { RPC } from 'soroban-client-nodejs'
import { createRpcClient } from '../lib/bitcoind-rpc/rpc-client.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import errors from '../lib/errors.js'
import Logger from '../lib/logger.js'
import util from '../lib/util.js'
import pushTxProcessor from './pushtx-processor.js'


const keys = keysFile[network.key]


/**
 * A class processing the push of transactions received through PandoTx
 */
class PandoTxProcessor {

    constructor() {
        this.checkProcessTxs = null

        // Check if processor is active
        if (keys.pandoTx?.process === 'active') {
            this.keyPush = keys.pandoTx?.keyPush
            this.keyResults = keys.pandoTx?.keyResults

            const sorobanUrl = keys.soroban?.rpc
            const socks5ProxyUrl = (sorobanUrl.includes('.onion')) ?
                keys.soroban?.socks5Proxy :
                null
            this.sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl)
            this.bitcoinRpc = createRpcClient()

            this.txsCache = new QuickLRU({
                maxSize: 100,
                maxAge: 1000 * 60 * 60 // one hour
            })
        }
    }

    /**
     * Start the processor
     * @returns {void}
     */
    start() {
        if (keys.pandoTx?.process === 'active') {
            Logger.info('PandoTx : Processor started')

            this.checkProcessTxs = setInterval(
                () => this.processTxs(),
                500
            )
        } else {
            Logger.info('PandoTx : Processor is inactive')
        }
    }

    /**
     * Stop the processor
     * @returns {void}
     */
    stop() {
        this.checkProcessTxs && clearInterval(this.checkProcessTxs)
    }

    /**
     * Process the transactions received through PandoTx
     * @returns {Promise<void>}
     */
    async processTxs() {
        // Check if processor is active
        if (keys.pandoTx?.process === 'active') {
            const entries = await this.sorobanRpc.directoryList(this.keyPush)

            await util.parallelCall(entries, async (rawTx) => {
                // Attempt to parse incoming string
                // as a bitcoin transaction in hex format
                let tx = null
                try {
                    tx = bitcoin.Transaction.fromHex(rawTx)
                } catch (error) {
                    Logger.error(error, `PandoTx : Error while parsing transaction ${rawTx}`)
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
                    await this.bitcoinRpc.getrawtransaction({ txid, verbose: false })
                    return
                } catch {
                    // Transaction not found in mempool
                    // We can proceed further
                }
                // Push the transaction to bitcoind
                await pushTxProcessor.pushTx(rawTx, true)
                this.txsCache.set(txid, true)
                // Notify successfull push
                await this.sorobanRpc.directoryAdd(this.keyResults, txid, 'short')
            })
        }
    }
}

export default PandoTxProcessor

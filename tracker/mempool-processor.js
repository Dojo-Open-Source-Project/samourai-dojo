/*!
 * tracker/mempool-buffer.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import zmq from 'zeromq/v5-compat.js'
import bitcoin from 'bitcoinjs-lib'

import util from '../lib/util.js'
import Logger from '../lib/logger.js'
import db from '../lib/db/mysql-db-wrapper.js'
import network from '../lib/bitcoin/network.js'
import { createRpcClient } from '../lib/bitcoind-rpc/rpc-client.js'
import keysFile from '../keys/index.js'
import Transaction from './transaction.js'
import TransactionsBundle from './transactions-bundle.js'
import { TransactionsCache } from './transactions-cache.js'

const keys = keysFile[network.key]

/**
 * A class managing a buffer for the mempool
 */
class MempoolProcessor {

    /**
     * Constructor
     * @param {object} notifSock - ZMQ socket used for notifications
     */
    constructor(notifSock) {
        // RPC client
        this.client = createRpcClient()
        // ZeroMQ socket for notifications sent to others components
        this.notifSock = notifSock
        // Mempool buffer
        this.mempoolBuffer = new TransactionsBundle()
        // ZeroMQ socket for bitcoind Txs messages
        this.txSock = null
        // ZeroMQ socket for pushtx messages
        this.pushTxSock = null
        // ZeroMQ socket for pushtx orchestrator messages
        this.orchestratorSock = null
        // Flag indicating if processor should process the transactions
        // Processor is deactivated if the tracker is late
        // (priority is given to the blockchain processor)
        this.isActive = false
        // Flag indicating that processing of unconfirmed transactions is currently running
        this.processingUnconfirmedTxs = false
    }

    /**
     * Start processing the mempool
     * @returns {Promise<void>}
     */
    async start() {
        this.checkUnconfirmedId = setInterval(
            () => this.checkUnconfirmed(),
            keys.tracker.unconfirmedTxsProcessPeriod
        )

        this.initSockets()

        this.processMempoolId = setInterval(
            () => this.processMempool(),
            keys.tracker.mempoolProcessPeriod
        )

        await this.processMempool()

        /*this.displayStatsId = setInterval(_.bind(this.displayMempoolStats, this), 60000)
        await this.displayMempoolStats()*/
    }

    /**
     * Stop processing
     */
    stop() {
        clearInterval(this.checkUnconfirmedId)
        clearInterval(this.processMempoolId)
        //clearInterval(this.displayStatsId)

        this.txSock && this.txSock.close()
        this.pushTxSock && this.pushTxSock.close()
        this.orchestratorSock && this.orchestratorSock.close()
    }

    /**
     * Initialiaze ZMQ sockets
     */
    initSockets() {
        // Socket listening to pushTx
        this.pushTxSock = zmq.socket('sub')
        this.pushTxSock.connect(`tcp://127.0.0.1:${keys.ports.notifpushtx}`)
        this.pushTxSock.subscribe('pushtx')

        this.pushTxSock.on('message', (topic, message) => {
            switch (topic.toString()) {
            case 'pushtx':
                this.onPushTx(message)
                break
            default:
                Logger.info(`Tracker : ${topic.toString()}`)
            }
        })

        Logger.info('Tracker : Listening for pushTx')

        // Socket listening to pushTx Orchestrator
        this.orchestratorSock = zmq.socket('sub')
        this.orchestratorSock.connect(`tcp://127.0.0.1:${keys.ports.orchestrator}`)
        this.orchestratorSock.subscribe('pushtx')

        this.orchestratorSock.on('message', (topic, message) => {
            switch (topic.toString()) {
            case 'pushtx':
                this.onPushTx(message)
                break
            default:
                Logger.info(`Tracker : ${topic.toString()}`)
            }
        })

        Logger.info('Tracker : Listening for pushTx orchestrator')

        // Socket listening to bitcoind Txs messages
        this.txSock = zmq.socket('sub')
        this.txSock.connect(keys.bitcoind.zmqTx)
        this.txSock.subscribe('rawtx')

        this.txSock.on('message', (topic, message) => {
            switch (topic.toString()) {
            case 'rawtx':
                this.onTx(message)
                break
            default:
                Logger.info(`Tracker : ${topic.toString()}`)
            }
        })

        Logger.info('Tracker : Listening for mempool transactions')
    }

    /**
     * Process transactions from the mempool buffer
     * @returns {Promise<void>}
     */
    async processMempool() {
        // Refresh the isActive flag
        await this._refreshActiveStatus()

        const activeLbl = this.isActive ? 'active' : 'inactive'
        Logger.info(`Tracker : Processing ${activeLbl} Mempool (${this.mempoolBuffer.size()} transactions)`)

        const currentMempool = this.mempoolBuffer.toArray()
        this.mempoolBuffer.clear()

        for (const mempoolTx of currentMempool) {
            if (!TransactionsCache.has(mempoolTx.txid)) {
                // Process the transaction
                const txCheck = await mempoolTx.checkTransaction()
                // Notify the transaction if needed
                if (txCheck && mempoolTx.doBroadcast) {
                    this.notifyTx(mempoolTx.txid)
                }
            }
        }
    }

    /**
     * On reception of a new transaction from bitcoind mempool
     * @param {Buffer} buf - transaction
     * @returns {Promise<void>}
     */
    async onTx(buf) {
        if (this.isActive) {
            try {
                let tx = bitcoin.Transaction.fromBuffer(buf)
                this.mempoolBuffer.addTransaction(tx)
            } catch (error) {
                Logger.error(error, 'Tracker : MempoolProcessor.onTx()')
                throw error
            }
        }
    }


    /**
     * On reception of a new transaction from /pushtx
     * @param {Buffer} buf - transaction
     * @returns {Promise<void>}
     */
    async onPushTx(buf) {
        try {
            let pushedTx = bitcoin.Transaction.fromHex(buf.toString())
            const txid = pushedTx.getId()

            Logger.info(`Tracker : Processing tx for pushtx ${txid}`)

            if (!TransactionsCache.has(txid)) {
                // Process the transaction
                const tx = new Transaction(pushedTx)
                const txCheck = await tx.checkTransaction()
                // Notify the transaction if needed
                if (txCheck && txCheck.broadcast)
                    this.notifyTx(txid)
            }
        } catch (error) {
            Logger.error(error, 'Tracker : MempoolProcessor.onPushTx()')
            throw error
        }
    }

    /**
     * Notify a new transaction
     * @param {string} txid - bitcoin transaction ID
     */
    notifyTx(txid) {
        // Real-time client updates for this transaction.
        // Any address input or output present in transaction
        // is a potential client to notify.
        if (this.notifSock)
            this.notifSock.send(['transaction', txid])
    }

    /**
     * Notify a new block
     * @param {number} height - block height
     * @param {string} hash - block hash
     */
    notifyBlock(height, hash) {
        // Notify clients of the block
        if (this.notifSock)
            this.notifSock.send(['block', JSON.stringify({ height: height, hash: hash })])
    }


    /**
     * Check unconfirmed transactions
     * @returns {Promise<void>}
     */
    async checkUnconfirmed() {
        // check that processing isn't already running
        if (this.processingUnconfirmedTxs) return

        const t0 = Date.now()

        Logger.info('Tracker : Processing unconfirmed transactions')

        const unconfirmedTxs = await db.getUnconfirmedTransactions()

        try {
            if (unconfirmedTxs.length > 0) {
                this.processingUnconfirmedTxs = true

                const unconfirmedTxLists = util.splitList(unconfirmedTxs, 10)

                await util.asyncPool(3, unconfirmedTxLists, async (txList) => {
                    const rpcRequests = txList.map((tx) => ({ method: 'getrawtransaction', params: { txid: tx.txnTxid, verbose: true }, id: tx.txnTxid }))
                    const txs = await this.client.batch(rpcRequests)

                    return await util.parallelCall(txs, async (rtx) => {
                        if (rtx.error) {
                            Logger.info(`Tracker : MempoolProcessor.checkUnconfirmed() - transaction not in mempool: ${rtx.id}`)
                            // Transaction not in mempool. Update LRU cache and database
                            TransactionsCache.delete(rtx.id)
                            // TODO: Notify clients of orphaned transaction
                            return db.deleteTransaction(rtx.id)
                        } else {
                            if (!rtx.result.blockhash) return null
                            // Transaction is confirmed
                            const block = await db.getBlockByHash(rtx.result.blockhash)
                            if (block && block.blockID) {
                                Logger.info(`Tracker : Marking TXID ${rtx.id} confirmed`)
                                return db.confirmTransactions([rtx.id], block.blockID)
                            }
                        }
                    })
                })
            }
        } catch (error) {
            Logger.error(error, 'Tracker : MempoolProcessor.checkUnconfirmed()')
        } finally {
            this.processingUnconfirmedTxs = false
        }


        // Logs
        const ntx = unconfirmedTxs.length
        const dt = ((Date.now() - t0) / 1000).toFixed(1)
        const per = (ntx === 0) ? 0 : ((Date.now() - t0) / ntx).toFixed(0)
        Logger.info(`Tracker : Finished processing unconfirmed transactions ${dt}s, ${ntx} tx, ${per}ms/tx`)
    }

    /**
     * Sets the isActive flag
     * @private
     */
    async _refreshActiveStatus() {
        // Get highest header in the blockchain
        // Get highest block processed by the tracker
        try {
            const [highestBlock, blockHeight] = await Promise.all([db.getHighestBlock(), this.client.getblockcount()])

            if (highestBlock == null || highestBlock.blockHeight === 0) {
                this.isActive = false
                return
            }

            // Tolerate a delay of 6 blocks
            this.isActive = (blockHeight >= 773800) && (blockHeight <= highestBlock.blockHeight + 6)
        } catch (error) {
            Logger.error(error, 'Tracker : MempoolProcessor._refreshActiveStatus()')
        }
    }

    /**
     * Log mempool statistics
     */
    displayMempoolStats() {
        Logger.info(`Tracker : Mempool Size: ${this.mempoolBuffer.size()}`)
    }

}


export default MempoolProcessor

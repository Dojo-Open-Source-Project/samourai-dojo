/*!
 * tracker/block.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import util from '../lib/util.js'
import Logger from '../lib/logger.js'
import db from '../lib/db/mysql-db-wrapper.js'
import Transaction from './transaction.js'
import TransactionsBundle from './transactions-bundle.js'

/**
 * @typedef {import('bitcoinjs-lib').Transaction} bitcoin.Transaction
 */

/**
 * @typedef {{ height: number, hash: string, time: number, previousblockhash: string }} BlockHeader
 */

/**
 * A class allowing to process a transaction
 */
class Block extends TransactionsBundle {

    /**
     * Constructor
     * @param {BlockHeader} header - block header
     * @param {bitcoin.Transaction[] | null} transactions - array of bitcoinjs transaction objects
     */
    constructor(header, transactions) {
        super()
        /**
         * @type {BlockHeader}
         */
        this.header = header

        try {
            if (transactions != null) {
                this.transactions = transactions.map((tx) => new Transaction(tx))
            }
        } catch (error) {
            Logger.error(error, 'Tracker : Block()')
            Logger.error(null, JSON.stringify(header))
        }
    }

    /**
     * Register the block and transactions of interest in db
     * @returns {Promise<bitcoin.Transaction[]>} returns an array of transactions to be broadcast
     */
    async processBlock() {
        Logger.info('Tracker : Beginning to process new block.')

        const t0 = Date.now()

        /**
         * Deduplicated transactions for broadcast
         * @type {Map<string, bitcoin.Transaction>}
         */
        const txsForBroadcast = new Map()

        const [txsForBroadcast1, txsForBroadcast2] = await Promise.all([this.processOutputs(), this.processInputs()])
        for (const tx of txsForBroadcast1) {
            txsForBroadcast.set(tx.getId(), tx)
        }

        for (const tx of txsForBroadcast2) {
            txsForBroadcast.set(tx.getId(), tx)
        }

        const aTxsForBroadcast = [...txsForBroadcast.values()]

        const blockId = await this.registerBlock()

        await this.confirmTransactions([...txsForBroadcast.keys()], blockId)

        // Logs and result returned
        const ntx = this.transactions.length
        const dt = ((Date.now() - t0) / 1000).toFixed(1)
        const per = ((Date.now() - t0) / ntx).toFixed(0)
        Logger.info(`Tracker :  Finished block ${this.header.height}, ${dt}s, ${ntx} tx, ${per}ms/tx`)

        return aTxsForBroadcast
    }


    /**
     * Process the transaction outputs
     * @returns {Promise<bitcoin.Transaction[]>} returns an array of transactions to be broadcast
     */
    async processOutputs() {
        /**
         * @type {bitcoin.Transaction[]}
         */
        const txsForBroadcast = []
        const filteredTxs = await this.prefilterByOutputs()
        await util.asyncPool(10, filteredTxs, async (filteredTx) => {
            await filteredTx.processOutputs()
            if (filteredTx.doBroadcast)
                txsForBroadcast.push(filteredTx.tx)
        })
        return txsForBroadcast
    }

    /**
     * Process the transaction inputs
     * @returns {Promise<bitcoin.Transaction[]>} returns an array of transactions to be broadcast
     */
    async processInputs() {
        /**
         * @type {bitcoin.Transaction[]}
         */
        const txsForBroadcast = []
        const filteredTxs = await this.prefilterByInputs()
        await util.asyncPool(10, filteredTxs, async (filteredTx) => {
            await filteredTx.processInputs()
            if (filteredTx.doBroadcast)
                txsForBroadcast.push(filteredTx.tx)
        })
        return txsForBroadcast
    }

    /**
     * Store the block in db
     * @returns {Promise<number>} returns the id of the block
     */
    async registerBlock() {
        const previousBlock = await db.getBlockByHash(this.header.previousblockhash)
        const previousID = (previousBlock && previousBlock.blockID) ? previousBlock.blockID : null

        const blockId = await db.addBlock({
            blockHeight: this.header.height,
            blockHash: this.header.hash,
            blockTime: this.header.time,
            blockParent: previousID
        })

        Logger.info(`Tracker :  Added block ${this.header.height} (id=${blockId})`)

        return blockId
    }

    /**
     * Confirm the transactions in db
     * @param {string[]} txids - set of transactions IDs stored in db
     * @param {number} blockId - id of the block
     * @returns {Promise<any[]>}
     */
    async confirmTransactions(txids, blockId) {
        const txidLists = util.splitList(txids, 100)
        return util.asyncPool(10, txidLists, list => db.confirmTransactions(list, blockId))
    }

    /**
     * Register the block header
     * @param {number} prevBlockID - id of previous block
     * @returns {Promise<number>}
     */
    async checkBlockHeader(prevBlockID) {
        Logger.info('Tracker : Beginning to process new block header.')

        // Insert the block header into the database
        const blockId = await db.addBlock({
            blockHeight: this.header.height,
            blockHash: this.header.hash,
            blockTime: this.header.time,
            blockParent: prevBlockID
        })

        Logger.info(`Tracker :  Added block header ${this.header.height} (id=${blockId})`)

        return blockId
    }

}

export default Block

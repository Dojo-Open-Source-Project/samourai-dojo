/*!
 * tracker/transactions-bundle.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import util from '../lib/util.js'
import db from '../lib/db/mysql-db-wrapper.js'
import addrHelper from '../lib/bitcoin/addresses-helper.js'
import Transaction from './transaction.js'
import { TransactionsCache } from './transactions-cache.js'

/**
 * @typedef {import('bitcoinjs-lib').Transaction} bitcoin.Transaction
 */

/**
 * A base class defining a set of transactions (mempool, block)
 */
class TransactionsBundle {

    /**
     * Constructor
     * @constructor
     * @param {bitcoin.Transaction[]=} txs - array of bitcoin transaction objects
     */
    constructor(txs) {
        /**
         * List of transactions
         * @type Transaction[]
         */
        this.transactions = (txs == null) ? [] : txs.map((tx) => new Transaction(tx))
    }

    /**
     * Adds a transaction
     * @param {bitcoin.Transaction} tx - transaction object
     */
    addTransaction(tx) {
        if (tx) {
            this.transactions.push(new Transaction(tx))
        }
    }

    /**
     * Clear the bundle
     */
    clear() {
        this.transactions = []
    }

    /**
     * Return the bundle as an array of transactions
     * @returns {Transaction[]}
     */
    toArray() {
        return [...this.transactions]
    }

    /**
     * Get the size of the bundle
     * @returns {number} return the number of transactions stored in the bundle
     */
    size() {
        return this.transactions.length
    }

    /**
     * Find the transactions of interest
     * based on theirs inputs
     * @returns {Promise<Transaction[]>} returns an array of transactions objects
     */
    async prefilterByInputs() {
        // Process transactions by slices of 5000 transactions
        const MAX_NB_TXS = 5000
        const lists = util.splitList(this.transactions, MAX_NB_TXS)
        const results = await util.parallelCall(lists, txs => this._prefilterByInputs(txs))
        return results.flat()
    }

    /**
     * Find the transactions of interest
     * based on theirs outputs
     * @returns {Promise<Transaction[]>} returns an array of transactions objects
     */
    async prefilterByOutputs() {
        // Process transactions by slices of 5000 transactions
        const MAX_NB_TXS = 5000
        const lists = util.splitList(this.transactions, MAX_NB_TXS)
        const results = await util.parallelCall(lists, txs => this._prefilterByOutputs(txs))
        return results.flat()
    }

    /**
     * Find the transactions of interest
     * based on theirs outputs (internal implementation)
     * @params {Transaction[]} txs - array of transactions objects
     * @returns {Awaited<Promise<Transaction[]>>} returns an array of transactions objects
     */
    async _prefilterByOutputs(txs) {
        /**
         * @type {Transaction[]}
         */
        const alreadySeenTXsOfInterest = []
        const addresses = []
        const filteredIndexTxs = []
        const indexedOutputs = {}

        // Index the transaction outputs
        for (const index in txs) {
            const tx = txs[index]
            const txid = tx.txid

            /**
             * Check if transaction has been checked in the past.
             * If it has been, check for value:
             *  - true = is transaction of interest, save and skip processing
             *  - false = skip entirely
             */
            if (TransactionsCache.has(txid)) {
                if (TransactionsCache.get(txid)) {
                    alreadySeenTXsOfInterest.push(tx)
                }
                continue
            }

            for (const index_ in tx.tx.outs) {
                const script = tx.tx.outs[index_].script
                const address = addrHelper.outputScript2Address(script)

                if (address) {
                    addresses.push(address)
                    if (!indexedOutputs[address])
                        indexedOutputs[address] = []
                    indexedOutputs[address].push(index)
                }
            }
        }

        // Prefilter
        const outRes = await db.getUngroupedHDAccountsByAddresses(addresses)
        for (const index in outRes) {
            const key = outRes[index].addrAddress
            const indexTxs = indexedOutputs[key]
            if (indexTxs) {
                for (const indexTx of indexTxs)
                    if (!filteredIndexTxs.includes(indexTx))
                        filteredIndexTxs.push(indexTx)
            }
        }

        return [...alreadySeenTXsOfInterest, ...filteredIndexTxs.map(x => txs[x])]
    }

    /**
     * Find the transactions of interest
     * based on theirs inputs (internal implementation)
     * @params {Transaction[]} txs - array of transactions objects
     * @returns {Awaited<Promise<Transaction[]>>} returns an array of transactions objects
     */
    async _prefilterByInputs(txs) {
        /**
         * @type {Transaction[]}
         */
        const alreadySeenTXsOfInterest = []
        const inputs = []
        const filteredIndexTxs = []
        const indexedInputs = {}

        for (const index in txs) {
            const tx = txs[index]
            const txid = tx.txid

            /**
             * Check if transaction has been checked in the past.
             * If it has been, check for value:
             *  - true = is transaction of interest, save and skip processing
             *  - false = skip entirely
             */
            if (TransactionsCache.has(txid)) {
                if (TransactionsCache.get(txid)) {
                    alreadySeenTXsOfInterest.push(tx)
                }
                continue
            }

            for (const index_ in tx.tx.ins) {
                const spendHash = tx.tx.ins[index_].hash
                const spendTxid = Buffer.from(spendHash).reverse().toString('hex')
                const spendIndex = tx.tx.ins[index_].index
                inputs.push({ txid: spendTxid, index: spendIndex })
                const key = `${spendTxid}-${spendIndex}`
                if (!indexedInputs[key])
                    indexedInputs[key] = []
                indexedInputs[key].push(index)
            }
        }

        // Prefilter
        const lists = util.splitList(inputs, 1000)
        const results = await util.parallelCall(lists, list => db.getOutputSpends(list))
        const inRes = results.flat()
        for (const index in inRes) {
            const key = `${inRes[index].txnTxid}-${inRes[index].outIndex}`
            const indexTxs = indexedInputs[key]
            if (indexTxs) {
                for (const indexTx of indexTxs)
                    if (!filteredIndexTxs.includes(indexTx))
                        filteredIndexTxs.push(indexTx)
            }
        }

        return [...alreadySeenTXsOfInterest, ...filteredIndexTxs.map(x => txs[x])]
    }

}

export default TransactionsBundle

/*!
 * tracker/transaction.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import util from '../lib/util.js'
import Logger from '../lib/logger.js'
import addrHelper from '../lib/bitcoin/addresses-helper.js'
import hdaHelper from '../lib/bitcoin/hd-accounts-helper.js'
import db from '../lib/db/mysql-db-wrapper.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import { TransactionsCache } from './transactions-cache.js'

const keys = keysFile[network.key]
const gapLimit = [keys.gap.external, keys.gap.internal]

/**
 * @typedef {import('bitcoinjs-lib').Transaction} bitcoin.Transaction
 */

/**
 * A class allowing to process a transaction
 */
class Transaction {

    /**
     * Constructor
     * @param {bitcoin.Transaction} tx - transaction object
     */
    constructor(tx) {
        /**
         * @type {bitcoin.Transaction}
         */
        this.tx = tx
        /**
         * @type {string}
         */
        this.txid = this.tx.getId()
        // ID of transaction stored in db
        /**
         * @type {number | null}
         */
        this.storedTxnID = null
        /**
         * Should this transaction be broadcast out to connected clients?
         * @type {boolean}
         */
        this.doBroadcast = false
    }

    /**
     * Register transaction in db if it's a transaction of interest
     * @returns {Promise<{ tx:object, broadcast: boolean }>} returns a composite result object
     */
    async checkTransaction() {
        try {
            // Process transaction inputs and outputs
            await Promise.all([this.processInputs(), this.processOutputs()])

            // If this point reached with no errors,
            // store the fact that this transaction was checked.
            TransactionsCache.set(this.txid, this.doBroadcast)

            return {
                broadcast: this.doBroadcast
            }

        } catch (error) {
            Logger.error(error, 'Tracker : Transaction.checkTransaction()')
            throw error
        }
    }

    /**
     * Process transaction inputs
     * @returns {Promise<void>}
     */
    async processInputs() {
        // Array of inputs spent
        const spends = []
        // Store input indices, keyed by `txid-outindex` for easy retrieval
        const indexedInputs = {}
        // Store database ids of double spend transactions
        const doubleSpentTxnIDs = []
        // Store inputs of interest
        const inputs = []

        // Extracts inputs information
        let index = 0

        for (let input of this.tx.ins) {
            const spendTxid = Buffer.from(input.hash).reverse().toString('hex')
            spends.push({ txid: spendTxid, index: input.index })
            indexedInputs[`${spendTxid}-${input.index}`] = index
            index++
        }

        // Check if we find some inputs of interest
        const results = await db.getOutputSpends(spends)

        if (results.length === 0)
            return null

        // Flag the transaction for broadcast
        this.doBroadcast = true

        // This transaction is spending an existing output.
        // This is value leaving a wallet's addresses.
        // Each result contains
        //  {outID, addrAddress, outAmount, txnTxid, outIndex, spendingTxnID/null}

        // Store the transaction in db
        await this._ensureTransaction()

        // Prepare the inputs
        for (let r of results) {
            const index = indexedInputs[`${r.txnTxid}-${r.outIndex}`]

            inputs.push({
                txnID: this.storedTxnID,
                outID: r.outID,
                inIndex: index,
                inSequence: this.tx.ins[index].sequence
            })

            // Detect potential double spends
            if (r.spendingTxnID !== null && r.spendingTxnID !== this.storedTxnID) {
                Logger.info(`Tracker : DOUBLE SPEND of ${r.txnTxid}-${r.outIndex} by ${this.txid}!`)
                // Delete the existing transaction that has been double-spent:
                // since the deepest block keeps its transactions, this will
                // eventually work itself out, and the wallet will not show
                // two transactions spending the same output.
                doubleSpentTxnIDs.push(r.spendingTxnID)
            }
        }

        // Record the inputs of interest in the database
        await db.addInputs(inputs)

        // Process the double spends
        if (doubleSpentTxnIDs.length > 0) {
            // Get txids to update LRU cache
            const txs = await db.getTransactionsById(doubleSpentTxnIDs)

            for (let tx of txs)
                TransactionsCache.delete(tx.txnTxid)

            await db.deleteTransactionsByID(doubleSpentTxnIDs)
        }
    }

    /**
     * Process transaction outputs
     * @returns {Promise<void>}
     */
    async processOutputs() {
        // Store outputs, keyed by address. Values are arrays of outputs
        const indexedOutputs = {}

        // Extracts outputs information
        let index = 0

        for (let output of this.tx.outs) {
            const address = addrHelper.outputScript2Address(output.script)

            if (address) {
                if (!indexedOutputs[address])
                    indexedOutputs[address] = []

                indexedOutputs[address].push({
                    index,
                    value: output.value,
                    script: output.script.toString('hex'),
                })
            }
            index++
        }

        // Array of addresses receiving tx outputs
        const addresses = Object.keys(indexedOutputs)

        // Store a list of known addresses that received funds
        let fundedAddresses = []

        // Get HD Accounts that own any of the output addresses
        const result = await db.getHDAccountsByAddresses(addresses)

        // Get outputs spending to loose addresses first
        const aLooseAddr = this._processOutputsLooseAddresses(result.loose, indexedOutputs)
        fundedAddresses = [...fundedAddresses, ...aLooseAddr]

        // Get outputs spending to a tracked account
        const aHdAcctAddr = await this._processOutputsHdAccounts(result.hd, indexedOutputs)
        fundedAddresses = [...fundedAddresses, ...aHdAcctAddr]

        if (fundedAddresses.length === 0)
            return null

        // Flag the transaction for broadcast
        this.doBroadcast = true

        // Add the transaction to the database
        await this._ensureTransaction()

        // Associate transaction outputs with known addresses
        const outputs = []

        for (let a of fundedAddresses) {
            outputs.push({
                txnID: this.storedTxnID,
                addrID: a.addrID,
                outIndex: a.outIndex,
                outAmount: a.outAmount,
                outScript: a.outScript,
            })
        }

        await db.addOutputs(outputs)
    }

    /**
     * Process outputs sending to tracked loose addresses
     * @param {object[]} addresses - array of address objects
     * @param {object} indexedOutputs - outputs indexed by address
     * @returns {object[]} return an array of funded addresses
     *  {addrID: ..., outIndex: ..., outAmount: ..., outScript: ...}
     */
    _processOutputsLooseAddresses(addresses, indexedOutputs) {
        // Store a list of known addresses that received funds
        const fundedAddresses = []

        // Get outputs spending to loose addresses first
        for (let a of addresses) {
            if (indexedOutputs[a.addrAddress]) {
                for (let output of indexedOutputs[a.addrAddress]) {
                    fundedAddresses.push({
                        addrID: a.addrID,
                        outIndex: output.index,
                        outAmount: output.value,
                        outScript: output.script,
                    })
                }
            }
        }

        return fundedAddresses
    }

    /**
     * Process outputs sending to tracked hd accounts
     * @param {object[]} hdAccounts - array of hd account objects
     * @param {object} indexedOutputs - outputs indexed by address
     * @returns {Promise<object[]>} return an array of funded addresses
     *  {addrID: ..., outIndex: ..., outAmount: ..., outScript: ...}
     */
    async _processOutputsHdAccounts(hdAccounts, indexedOutputs) {
        // Store a list of known addresses that received funds
        const fundedAddresses = []
        const xpubList = Object.keys(hdAccounts)

        if (xpubList.length > 0) {
            await util.parallelCall(xpubList, async xpub => {
                const usedNewAddresses = await this._deriveNewAddresses(
                    xpub,
                    hdAccounts[xpub],
                    indexedOutputs
                )

                const usedNewResults = await db.getAddresses(usedNewAddresses)

                // Append these address results to the hdAccount address list
                Array.prototype.push.apply(hdAccounts[xpub].addresses, usedNewResults)

                for (let entry of hdAccounts[xpub].addresses) {
                    if (indexedOutputs[entry.addrAddress]) {
                        for (let output of indexedOutputs[entry.addrAddress]) {
                            fundedAddresses.push({
                                addrID: entry.addrID,
                                outIndex: output.index,
                                outAmount: output.value,
                                outScript: output.script,
                            })
                        }
                    }
                }
            })
        }

        return fundedAddresses
    }

    /**
     * Derive new addresses for a hd account
     * Check if tx addresses are at or beyond the next unused
     * index for the HD chain. Derive additional addresses
     * to replace the gap limit and add those addresses to
     * the database. Make sure to account for tx sending to
     * newly-derived addresses.
     *
     * @param {string} xpub
     * @param {object} hdAccount - hd account object
     * @param {object} indexedOutputs - outputs indexed by address
     * @returns {Promise<object[]>} returns an array of the new addresses used
     */
    async _deriveNewAddresses(xpub, hdAccount, indexedOutputs) {
        const hdType = hdAccount.hdType

        let derivedIndices = [-1, -1]

        // Get maximum derived address indices for each chain
        derivedIndices = await db.getHDAccountDerivedIndices(xpub)

        // Get the next unused chain indices for this account
        const unusedIndices = await db.getHDAccountNextUnusedIndices(xpub)

        const newAddresses = []
        const usedNewAddresses = {}

        // Get the maximum used index in the addresses
        for (let chain of [0, 1]) {
            // Get addresses for this account that are on this chain
            const chainAddresses = hdAccount.addresses.filter(v => {
                return v.hdAddrChain === chain
            })

            if (chainAddresses.length === 0)
                continue

            // Get the maximum used address on this chain
            const chainMaxUsed = util.maxBy(chainAddresses, a => {
                return a.hdAddrIndex
            })

            let chainMaxUsedIndex = chainMaxUsed.hdAddrIndex

            // If max used index will not advance the unused index, move on
            if (chainMaxUsedIndex < unusedIndices[chain])
                continue

            // If max derived index is beyond max used index plus gap limit.
            if (derivedIndices[chain] >= chainMaxUsedIndex + gapLimit[chain]) {
                // Check that we don't have a hole in the next <gapLimit> indices
                const nbDerivedIndicesForward = await db.getHDAccountNbDerivedIndices(
                    xpub,
                    chain,
                    chainMaxUsedIndex,
                    chainMaxUsedIndex + gapLimit[chain]
                )

                if (nbDerivedIndicesForward < gapLimit[chain] + 1) {
                    // Hole detected. Force derivation.
                    derivedIndices[chain] = chainMaxUsedIndex
                } else {
                    // Move on
                    continue
                }
            }

            let done

            do {
                done = true

                // Derive additional addresses beyond the max index...
                // ..and including the gap limit beyond the max used
                const minIndex = derivedIndices[chain] + 1
                const maxIndex = chainMaxUsedIndex + gapLimit[chain] + 1
                const indices = util.range(minIndex, maxIndex)

                const derived = await hdaHelper.deriveAddresses(xpub, chain, indices, hdType)

                newAddresses.push(...derived)

                Logger.info(`Tracker : Derived hdID(${hdAccount.hdID}) M/${chain}/${indices.join(',')}`)

                // Update view of derived address indices
                derivedIndices[chain] = chainMaxUsedIndex + gapLimit[chain]

                // Check derived addresses for use in this transaction
                for (let d of derived) {
                    if (indexedOutputs[d.address]) {
                        Logger.info(`Tracker : Derived address already in outputs: M/${d.chain}/${d.index}`)
                        // This transaction spends to an address
                        // beyond the original derived gap limit!
                        chainMaxUsedIndex = d.index
                        usedNewAddresses[d.address] = d
                        done = false
                    }
                }
            } while (!done)

        }

        await db.addAddressesToHDAccount(xpub, newAddresses)
        return Object.keys(usedNewAddresses)
    }


    /**
     * Store the transaction in database
     * @returns {Promise}
     */
    async _ensureTransaction() {
        if (this.storedTxnID == null) {
            this.storedTxnID = await db.ensureTransactionId(this.txid)

            await db.addTransaction({
                txid: this.txid,
                version: this.tx.version,
                locktime: this.tx.locktime,
            })

            Logger.info(`Tracker :  Storing transaction ${this.txid}`)
        }
    }

}

export default Transaction

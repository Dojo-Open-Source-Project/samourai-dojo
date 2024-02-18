/*!
 * lib/wallet/wallet-info.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import db from '../db/mysql-db-wrapper.js'
import util from '../util.js'
import rpcLatestBlock from '../bitcoind-rpc/latest-block.js'
import rpcFees from '../bitcoind-rpc/fees.js'
import addrService from '../bitcoin/addresses-service.js'
import HdAccountInfo from './hd-account-info.js'
import AddressInfo from './address-info.js'


/**
 * A class storing information about a (full|partial) wallet
 * Provides a set of methods allowing to retrieve specific information
 * @class WalletInfo
 */
class WalletInfo {

    /**
     * Constructor
     * @constructor
     * @param {object=} entities - wallet entities (hdaccounts, addresses, pubkeys)
     */
    constructor(entities) {
        // Initializes wallet properties
        this.entities = entities

        this.wallet = {
            finalBalance: 0
        }

        this.info = {
            fees: {},
            estimatorFees: {},
            latestBlock: {
                height: rpcLatestBlock.height,
                hash: rpcLatestBlock.hash,
                time: rpcLatestBlock.time,
            }
        }

        this.addresses = []
        this.txs = []
        this.unspentOutputs = []
        this.nTx = 0
    }


    /**
     * Ensure hd accounts exist in database
     * @returns {Promise<Array<any>>}
     */
    async ensureHdAccounts() {
        return util.parallelCall(this.entities.xpubs, async xpub => {
            const hdaInfo = new HdAccountInfo(xpub)
            return hdaInfo.ensureHdAccount()
        })
    }

    /**
     * Load information about the hd accounts
     * @returns {Promise<Array<any>>}
     */
    async loadHdAccountsInfo() {
        return util.parallelCall(this.entities.xpubs, async xpub => {
            const hdaInfo = new HdAccountInfo(xpub)
            await hdaInfo.loadInfo()
            this.wallet.finalBalance += hdaInfo.finalBalance
            this.addresses.push(hdaInfo)
        })
    }

    /**
     * Ensure addresses exist in database
     * @returns {Promise}
     */
    async ensureAddresses() {
        const importAddrs = []

        const addrIdMap = await db.getAddressesIds(this.entities.addrs)

        for (let addr of this.entities.addrs) {
            if (!addrIdMap[addr])
                importAddrs.push(addr)
        }

        // Import new addresses
        return addrService.restoreAddresses(importAddrs, true)
    }

    /**
     * Filter addresses that belong to an active hd account
     * @returns {Promise<void>}
     */
    async filterAddresses() {
        const res = await db.getXpubByAddresses(this.entities.addrs)

        for (let addr in res) {
            let xpub = res[addr]
            if (this.entities.xpubs.includes(xpub)) {
                let index = this.entities.addrs.indexOf(addr)
                if (index > -1) {
                    this.entities.addrs.splice(index, 1)
                    this.entities.pubkeys.splice(index, 1)
                }
            }
        }
    }

    /**
     * Load information about the addresses
     * @returns {Promise<Array<void>>}
     */
    async loadAddressesInfo() {
        return util.parallelCall(this.entities.addrs, async address => {
            const addrInfo = new AddressInfo(address)
            await addrInfo.loadInfo()
            this.wallet.finalBalance += addrInfo.finalBalance
            this.addresses.push(addrInfo)
        })
    }

    /**
     * Loads a partial list of transactions for this wallet
     * @param {number} page - page index
     * @param {number} count - number of transactions per page
     * @param {boolean=} txBalance - True if past wallet balance
     *    should be computed for each transaction
     * @returns {Promise<void>}
     */
    async loadTransactions(page, count, txBalance) {
        this.txs = await db.getTxsByAddrAndXpubs(
            this.entities.addrs,
            this.entities.xpubs,
            page,
            count
        )

        if (txBalance) {
            // Computes wallet balance after each transaction
            let balance = this.wallet.finalBalance
            for (let index = 0; index < this.txs.length; index++) {
                this.txs[index].balance = balance
                balance -= this.txs[index].result
            }
        }
    }

    /**
     * Loads the number of transactions for this wallet
     * @returns {Promise<void>}
     */
    async loadNbTransactions() {
        const nbTxs = await db.getAddrAndXpubsNbTransactions(
            this.entities.addrs,
            this.entities.xpubs
        )

        if (nbTxs != null)
            this.nTx = nbTxs
    }

    /**
     * Loads tinfo about the fee rates
     * @returns {Promise<void>}
     */
    async loadFeesInfo() {
        this.info.fees = await rpcFees.getFees()

        try {
            this.info.estimatorFees = rpcFees.getEstimatorFees()
        } catch {
            this.info.estimatorFees = null
        }
    }

    /**
     * Loads the list of unspent outputs for this wallet
     * @returns {Promise<void>}
     */
    async loadUtxos() {
        // Load the utxos for the hd accounts
        await util.parallelCall(this.entities.xpubs, async xpub => {
            const hdaInfo = new HdAccountInfo(xpub)
            const utxos = await hdaInfo.loadUtxos()
            for (let utxo of utxos)
                this.unspentOutputs.push(utxo)
        })

        // Load the utxos for the addresses
        const utxos = await db.getUnspentOutputs(this.entities.addrs)

        for (let utxo of utxos) {
            const config =
                (utxo.blockHeight == null)
                    ? 0
                    : (rpcLatestBlock.height - utxo.blockHeight + 1)

            const entry = {
                tx_hash: utxo.txnTxid,
                tx_output_n: utxo.outIndex,
                tx_version: utxo.txnVersion,
                tx_locktime: utxo.txnLocktime,
                value: utxo.outAmount,
                script: utxo.outScript,
                addr: utxo.addrAddress,
                confirmations: config
            }

            this.unspentOutputs.push(entry)
        }

        // Order the utxos
        this.unspentOutputs.sort((a, b) => b.confirmations - a.confirmations)
    }

    /**
     * Post process addresses and public keys
     */
    async postProcessAddresses() {
        for (let b = 0; b < this.entities.pubkeys.length; b++) {
            const pk = this.entities.pubkeys[b]

            if (pk) {
                const address = this.entities.addrs[b]

                // Add pubkeys in this.addresses
                for (let c = 0; c < this.addresses.length; c++) {
                    if (address === this.addresses[c].address)
                        this.addresses[c].pubkey = pk
                }

                // Add pubkeys in this.txs
                for (let d = 0; d < this.txs.length; d++) {
                    // inputs
                    for (let e = 0; e < this.txs[d].inputs.length; e++) {
                        if (address === this.txs[d].inputs[e].prev_out.addr)
                            this.txs[d].inputs[e].prev_out.pubkey = pk
                    }
                    // outputs
                    for (let e = 0; e < this.txs[d].out.length; e++) {
                        if (address === this.txs[d].out[e].addr)
                            this.txs[d].out[e].pubkey = pk
                    }
                }

                // Add pubkeys in this.unspentOutputs
                for (let f = 0; f < this.unspentOutputs.length; f++) {
                    if (address === this.unspentOutputs[f].addr) {
                        this.unspentOutputs[f].pubkey = pk
                    }
                }
            }
        }
    }

    /**
     * Post process hd accounts (xpubs translations)
     */
    async postProcessHdAccounts() {
        for (let b = 0; b < this.entities.xpubs.length; b++) {
            const entityXPub = this.entities.xpubs[b]
            const entityYPub = this.entities.ypubs[b]
            const entityZPub = this.entities.zpubs[b]

            if (entityYPub || entityZPub) {
                const tgtXPub = entityYPub || entityZPub

                // Translate xpub => ypub/zpub in this.addresses
                for (let c = 0; c < this.addresses.length; c++) {
                    if (entityXPub === this.addresses[c].address)
                        this.addresses[c].address = tgtXPub
                }

                // Translate xpub => ypub/zpub in this.txs
                for (let d = 0; d < this.txs.length; d++) {
                    // inputs
                    for (let e = 0; e < this.txs[d].inputs.length; e++) {
                        const xpub = this.txs[d].inputs[e].prev_out.xpub
                        if (xpub && (xpub.m === entityXPub))
                            this.txs[d].inputs[e].prev_out.xpub.m = tgtXPub
                    }

                    // outputs
                    for (let e = 0; e < this.txs[d].out.length; e++) {
                        const xpub = this.txs[d].out[e].xpub
                        if (xpub && (xpub.m === entityXPub))
                            this.txs[d].out[e].xpub.m = tgtXPub
                    }
                }

                // Translate xpub => ypub/zpub in this.unspentOutputs
                for (let f = 0; f < this.unspentOutputs.length; f++) {
                    const xpub = this.unspentOutputs[f].xpub
                    if (xpub && (xpub.m === entityXPub)) {
                        this.unspentOutputs[f].xpub.m = tgtXPub
                    }
                }
            }
        }
    }

    /**
     * Return a plain old js object with wallet properties
     * @returns {object}
     */
    toPojo() {
        return {
            wallet: {
                final_balance: this.wallet.finalBalance
            },
            info: {
                fees: this.info.fees,
                estimatorFees: this.info.estimatorFees,
                latest_block: this.info.latestBlock
            },
            addresses: this.addresses.map(a => a.toPojo()),
            txs: this.txs,
            unspent_outputs: this.unspentOutputs,
            n_tx: this.nTx
        }
    }

}

export default WalletInfo

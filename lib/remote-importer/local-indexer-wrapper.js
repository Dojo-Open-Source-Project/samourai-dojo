/*!
 * lib/remote-importer/local-indexer-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import net from 'net'
import bitcoin from 'bitcoinjs-lib'
// eslint-disable-next-line import/no-unresolved
import { ElectrumClient } from '@samouraiwallet/electrum-client'

import Logger from '../logger.js'
import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import Wrapper from './wrapper.js'
import Util from '../util.js'

const keys = keysFile[network.key]
const activeNet = network.network

/**
 * @description Detects if a network port is reachable
 * @param port {number}
 * @param host {string}
 * @param timeout {number=}
 * @return {Promise<boolean>}
 */
async function isPortReachable(port, host, timeout = 1000) {
    if (typeof host !== 'string') {
        throw new TypeError('Specify a `host`')
    }

    const promise = new Promise(((resolve, reject) => {
        const socket = new net.Socket()

        const onError = () => {
            socket.destroy()
            reject()
        }

        socket.setTimeout(timeout)
        socket.once('error', onError)
        socket.once('timeout', onError)

        socket.connect(port, host, () => {
            socket.end()
            resolve()
        })
    }))

    try {
        await promise
        return true
    } catch {
        return false
    }
}

/**
 * @description Returns a promise that resolves when indexer API is available
 * @param port {number}
 * @param host {string}
 * @return {Promise<void>}
 */
const getActiveIndexer = (port, host) => {
    return new Promise((resolve) => {
        const interval = setInterval(async () => {
            const isReachable = await isPortReachable(port, host)

            if (isReachable) {
                clearInterval(interval)
                resolve()
            } else {
                Logger.info('Importer : Indexer not available, retrying in 20 seconds')
            }
        }, 20000)
    })
}

/**
 * Wrapper for a local indexer
 * Currently supports indexers
 * providing a RPC API compliant
 * with a subset of the electrum protocol
 */
class LocalIndexerWrapper extends Wrapper {

    constructor() {
        super(null, null)

        this.client = new ElectrumClient(keys.indexer.localIndexer.port, keys.indexer.localIndexer.host, keys.indexer.localIndexer.protocol, {
            onError: (error) => Logger.error(error, 'Importer : Electrum client error'),
            onConnect: () => Logger.info('Importer : Successfully connected to indexer'),
            onClose: () => Logger.info('Importer : Connection to indexer closed'),
            onLog: (msg) => Logger.info(`Importer : ${msg}`)
        })

        getActiveIndexer(keys.indexer.localIndexer.port, keys.indexer.localIndexer.host, keys.indexer.localIndexer.protocol)
            .then(() => {
                const init = () => this.client.initElectrum({ client: `Samourai Dojo v${keys.dojoVersion}`, version: '1.4' }, {
                    retryPeriod: 3000, // 3 SECONDS
                    pingPeriod: 60 * 1000, // 1 MINUTE
                    callback: async () => {
                        Logger.error(null, 'Importer : Cannot reconnect to indexer')
                        await Util.delay(60 * 1000)
                        init()
                    }
                }).catch(async (error) => {
                    Logger.error(error, 'Importer : Error when connecting to indexer')
                    await Util.delay(60 * 1000)
                    init()
                })

                init()
            })
    }

    /**
     * Translate a bitcoin address into a script hash
     * (@see https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes)
     * @param {string} address - bitcoin address
     * @returns {string} returns the script hash associated to the address
     */
    _getScriptHash(address) {
        const bScriptPubKey = bitcoin.address.toOutputScript(address, activeNet)
        const bScriptHash = bitcoin.crypto.sha256(bScriptPubKey)
        return Buffer.from(bScriptHash.reverse()).toString('hex')
    }

    /**
     * Retrieve information for a given address
     * @param {string} address - bitcoin address
     * @param {boolean} filterAddr - True if an upper bound should be used
     *     for #transactions associated to the address, False otherwise
     * @returns {Promise} returns an object
     *  { address: <bitcoin_address>, txids: <txids>, ntx: <total_nb_txs>}
     */
    async getAddress(address, filterAddr) {
        const returnValue = {
            address: address,
            ntx: 0,
            txids: []
        }

        const scriptHash = this._getScriptHash(address)

        const results = await this.client.blockchainScripthash_getHistory(scriptHash)

        returnValue.ntx = results.length
        returnValue.txids = results.map((tx) => tx.tx_hash)

        if (filterAddr && returnValue.ntx > keys.addrFilterThreshold) {
            Logger.info(`Importer : Import of ${address} rejected (too many transactions - ${returnValue.ntx})`)
            return {
                address: address,
                ntx: 0,
                txids: []
            }
        }

        return returnValue
    }

    /**
     * Retrieve information for a given list of addresses
     * @param {string} addresses - array of bitcoin addresses
     * @param {boolean} filterAddr - True if an upper bound should be used for #transactions associated to the address, False otherwise
     * @returns {Promise<{ address: string, txids: string[], ntx: number }>} returns an array of objects
     */
    async getAddresses(addresses, filterAddr) {
        let returnValue

        // Build a Map of script hashes and addresses
        const scriptHashAddrMap = new Map(addresses.map(address => ([this._getScriptHash(address), address])))
        const scriptHashes = [...scriptHashAddrMap.keys()]

        if (keys.indexer.localIndexer.batchRequests === 'active') {
            const scriptHashChunks = Util.splitList(scriptHashes, 50)
            const rpcResults = await Util.seriesCall(scriptHashChunks, (chunk) => this.client.blockchainScripthash_getHistoryBatch(chunk))

            returnValue = rpcResults.flat().map((rpcResult) => ({
                address: scriptHashAddrMap.get(rpcResult.param),
                ntx: rpcResult.result.length,
                txids: rpcResult.result.map((tx) => tx.tx_hash)
            }))
        } else {
            returnValue = await Util.asyncPool(5, scriptHashes, async (scriptHash) => {
                const result = await this.client.blockchainScripthash_getHistory(scriptHash)

                return {
                    address: scriptHashAddrMap.get(scriptHash),
                    ntx: result.length,
                    txids: result.map((tx) => tx.tx_hash)
                }
            })
        }

        if (filterAddr) {
            return returnValue.filter((val) => {
                if (val.ntx > keys.addrFilterThreshold) {
                    Logger.info(`Importer : Import of ${val.address} rejected (too many transactions - ${val.ntx})`)
                    return false
                }

                return true
            })
        }

        return returnValue
    }

    /**
     * Retrieve the height of the chaintip for the remote source
     * @returns {Promise<{chainTipHeight: number | null}>}
     */
    async getChainTipHeight() {
        let chainTipHeight = null
        const result = await this.client.blockchainHeaders_subscribe()

        if (result != null && result.height != null) {
            chainTipHeight = Number(result.height)
        }
        return { chainTipHeight: chainTipHeight }
    }
}

export default LocalIndexerWrapper

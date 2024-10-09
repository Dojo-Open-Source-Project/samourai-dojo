/*!
 * lib/remote-importer/local-rest-indexer-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import {fetch} from 'undici'
import bitcoin from 'bitcoinjs-lib'

import Logger from '../logger.js'
import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import Wrapper from './wrapper.js'

const keys = keysFile[network.key]
const activeNet = network.network

/**
 * Wrapper for a local indexer
 * providing a REST API
 */
class LocalRestIndexerWrapper extends Wrapper {

    /**
     * Constructor
     * @constructor
     * @param {string} url
     */
    constructor(url) {
        super(url, null)
    }

    /**
     * Send a GET request to the API
     * @param {string} route
     * @returns {Promise}
     */
    async _get(route) {
        const parameters = {
            method: 'GET',
            timeout: 15000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Dojo'
            }
        }

        const response = await fetch(`${this.base}${route}`, parameters)

        if (!response.ok) throw new Error(`Receive invalid status from server: ${response.status}`)

        return await response.json()
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
        const uri = `/blockchain/scripthash/${scriptHash}/history`
        const results = await this._get(uri)

        for (let r of results) {
            returnValue.txids.push(r.tx_hash)
            returnValue.ntx++
        }

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
     * @param {boolean} filterAddr - True if an upper bound should be used
     *     for #transactions associated to the address, False otherwise
     * @returns {Promise} returns an array of objects
     *  { address: <bitcoin_address>, txids: <txids>, ntx: <total_nb_txs>}
     */
    async getAddresses(addresses, filterAddr) {
        const returnValue = {}
        const scriptHash2Address = {}
        const scriptHashes = []

        for (let a of addresses) {
            const scriptHash = this._getScriptHash(a)
            scriptHashes.push(scriptHash)
            scriptHash2Address[scriptHash] = a
        }

        const sScriptHashes = scriptHashes.join(',')
        const uri = `/blockchain/scripthashes/history?scripthashes=${sScriptHashes}`
        const results = await this._get(uri)

        for (let r of results) {
            const a = scriptHash2Address[r.script_hash]
            returnValue[a] = {
                address: a,
                ntx: r.txids.length,
                txids: r.txids
            }
        }

        const aReturnValue = Object.values(returnValue)

        for (let index in aReturnValue) {
            if (filterAddr && aReturnValue[index].ntx > keys.addrFilterThreshold) {
                Logger.info(`Importer : Import of ${aReturnValue[index].address} rejected (too many transactions - ${aReturnValue[index].ntx})`)
                aReturnValue.splice(index, 1)
            }
        }

        return aReturnValue
    }

    /**
     * Retrieve the height of the chaintip for the remote source
     * @returns {Promise} returns an object
     *    {chainTipHeight: <chaintip_height>}
     */
    async getChainTipHeight() {
        let chainTipHeight = null
        const result = await this._get('/blocks/tip')
        if (result != null && result.height != null)
            chainTipHeight = Number.parseInt(result.height, 10)
        return { 'chainTipHeight': chainTipHeight }
    }

}

export default LocalRestIndexerWrapper

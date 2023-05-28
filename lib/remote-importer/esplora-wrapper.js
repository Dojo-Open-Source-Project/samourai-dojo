/*!
 * lib/remote-importer\esplora-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import axios from 'axios'

import Logger from '../logger.js'
import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import Wrapper from './wrapper.js'

const keys = keysFile[network.key]

/**
 * Wrapper for the esplora block explorer APIs
 */
class EsploraWrapper extends Wrapper {

    /**
     * Constructor
     * @constructor
     * @param {string} url
     */
    constructor(url) {
        super(url, keys.indexer.socks5Proxy)
    }

    /**
     * Send a GET request to the API
     * @param {string} route
     * @returns {Promise}
     */
    async _get(route) {
        const parameters = {
            url: `${this.base}${route}`,
            method: 'GET',
            responseType: 'json',
            timeout: 15000,
            headers: {
                'User-Agent': 'Dojo'
            }
        }

        // Sets socks proxy agent if required
        if (keys.indexer.socks5Proxy != null) {
            parameters.httpAgent = this.socksProxyAgent
            parameters.httpsAgent = this.socksProxyAgent
        }

        const result = await axios(parameters)
        return result.data
    }

    /**
     * Get a page of transactions related to a given address
     * @param {string} address - bitcoin address
     * @param {string} lastSeenTxid - last seen txid
     *  (see https://github.com/Blockstream/esplora/blob/master/API.md)
     * @returns {Promise}
     */
    async _getTxsForAddress(address, lastSeenTxid) {
        let uri = `/api/address/${address}/txs`
        if (lastSeenTxid)
            uri = `${uri}/chain/${lastSeenTxid}`

        const results = await this._get(uri)
        return results.map(tx => tx.txid)
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

        let lastSeenTxid = null

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const txids = await this._getTxsForAddress(address, lastSeenTxid)

            if (txids.length === 0)
                // we have all the transactions
                return returnValue

            returnValue.txids = [...returnValue.txids, ...txids]
            returnValue.ntx += returnValue.txids.length

            if (txids.length < EsploraWrapper.NB_TXS_PER_PAGE) {
                // we have all the transactions
                return returnValue
            } else if (filterAddr && returnValue.ntx > keys.addrFilterThreshold) {
                // we have too many transactions
                Logger.info(`Importer : Import of ${returnValue.address} rejected (too many transactions - ${returnValue.ntx})`)
                returnValue.txids = []
                returnValue.ntx = 0
                return returnValue
            } else {
                // we need a new iteration
                lastSeenTxid = txids.at(-1)
            }
        }
    }

    /**
     * Retrieve information for a given list of addresses
     * @param {string[]} addresses - array of bitcoin addresses
     * @param {boolean} filterAddr - True if an upper bound should be used
     *     for #transactions associated to the address, False otherwise
     * @returns {Promise} returns an array of objects
     *  { address: <bitcoin_address>, txids: <txids>, ntx: <total_nb_txs>}
     */
    async getAddresses(addresses, filterAddr) {
        const returnValue = []

        for (let a of addresses) {
            const returnValueAddr = await this.getAddress(a, filterAddr)
            returnValue.push(returnValueAddr)
        }

        return returnValue
    }

    /**
     * Retrieve the height of the chaintip for the remote source
     * @returns {Promise} returns an object
     *    {chainTipHeight: <chaintip_height>}
     */
    async getChainTipHeight() {
        let chainTipHeight = null
        const result = await this._get('/api/blocks/tip/height')
        if (result != null)
            chainTipHeight = Number.parseInt(result, 10)
        return { 'chainTipHeight': chainTipHeight }
    }

}

// Esplora returns a max of 25 txs per page
EsploraWrapper.NB_TXS_PER_PAGE = 25

export default EsploraWrapper

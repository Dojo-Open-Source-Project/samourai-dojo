/*!
 * lib/remote-importer/oxt-wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import {fetch} from 'undici'
import Logger from '../logger.js'
import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import Wrapper from './wrapper.js'

const keys = keysFile[network.key]

/**
 * Wrapper for the oxt.me block explorer APIs
 */
class OxtWrapper extends Wrapper {

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
            method: 'GET',
            timeout: 15000,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Dojo'
            }
        }

        // Sets socks proxy agent if required
        if (keys.indexer.socks5Proxy != null) {
            parameters.dispatcher = this.socksProxyAgent
        }

        const response = await fetch(`${this.base}${route}`, parameters)

        if (!response.ok) throw new Error(`Receive invalid status from server: ${response.status}`)

        return await response.json()
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
        // Try to retrieve more txs than the 1000 managed by the backend
        const uri = `/addresses/${address}/txids?count=${keys.addrFilterThreshold + 1}`
        const result = await this._get(uri)

        const returnValue = {
            address: address,
            ntx: result.count,
            txids: []
        }

        // Check if we should filter this address
        if (filterAddr && returnValue.ntx > keys.addrFilterThreshold) {
            Logger.info(`Importer : Import of ${returnValue.address} rejected (too many transactions - ${returnValue.ntx})`)
            return returnValue
        }

        returnValue.txids = result.data.map(t => t.txid)
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
        const returnValue = []

        // Send a batch request for all the addresses
        // For each address, try to retrieve more txs than the 1000 managed by the backend
        const stringAddr = addresses.join(',')
        const uri = `/addresses/multi/txids?count=${keys.addrFilterThreshold + 1}&addresses=${stringAddr}`
        const results = await this._get(uri)

        for (let r of results.data) {
            const returnValueAddr = {
                address: r.address,
                ntx: r.txids.length,
                txids: []
            }

            // Check if we should filter this address
            if (filterAddr && returnValueAddr.ntx > keys.addrFilterThreshold) {
                Logger.info(`Importer : Import of ${returnValueAddr.address} rejected (too many transactions - ${returnValueAddr.ntx})`)
            } else {
                returnValueAddr.txids = r.txids
            }

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
        const result = await this._get('/lastblock')
        if (result != null && result.data.length === 1)
            chainTipHeight = Number.parseInt(result.data[0].height, 10)
        return { 'chainTipHeight': chainTipHeight }
    }

}

export default OxtWrapper

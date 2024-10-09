/*!
 * lib/remote-importer/wrapper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import {socksDispatcher} from '../fetch-socks/fetch-socks.js'


/**
 * Abstract class defining a wrapper for a remote API
 * @abstract
 */
class Wrapper {

    /**
     * Constructor
     * @constructor
     * @param {string | null} url
     * @param {string | null | undefined} socks5Proxy
     */
    constructor(url, socks5Proxy) {
        this.base = url
        this.socksProxyAgent = socks5Proxy
            ? socksDispatcher({type: 5, host: new URL(socks5Proxy).host, port: new URL(socks5Proxy).port})
            : null
    }

    /**
     * Retrieve information for a given address
     * @param {string} address - bitcoin address
     * @param {boolean} filterAddr - True if an upper bound should be used
     *     for #transactions associated to the address, False otherwise
     * @returns {Promise} returns an object
     *  { address: <bitcoin_address>, txids: <txids>, ntx: <total_nb_txs>}
     */
    // eslint-disable-next-line no-unused-vars
    async getAddress(address, filterAddr) {}

    /**
     * Retrieve information for a given list of addresses
     * @param {string} addresses - array of bitcoin addresses
     * @param {boolean} filterAddr - True if an upper bound should be used
     *     for #transactions associated to the address, False otherwise
     * @returns {Promise} returns an array of objects
     *  { address: <bitcoin_address>, txids: <txids>, ntx: <total_nb_txs>}
     */
    // eslint-disable-next-line no-unused-vars
    async getAddresses(addresses, filterAddr) {}

}

export default Wrapper

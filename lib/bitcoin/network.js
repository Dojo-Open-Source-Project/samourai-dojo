/*!
 * lib/bitcoin/network.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import bitcoin from 'bitcoinjs-lib'
import keys from '../../keys/index.js'


/**
 * A set of keywords encoding for mainnet
 */
const MAINNET_KEY = [
    'bitcoin'
]

/**
 * A set of keywords encoding for testnet
 */
const TESTNET_KEY = [
    'testnet',
    'testing',
    'test'
]


/**
 * A singleton determining which network to run: bitcoin or testnet
 */
class Network {

    constructor() {
        // Check if mainnet config is detected in index.js
        for (let kw of MAINNET_KEY) {
            if (kw in keys) {
                this.key = 'bitcoin'
                this.network = bitcoin.networks.bitcoin
                this.ibdBlockHeight = 864700
                return
            }
        }
        // Check if testnet config is detected in index.js
        for (let kw of TESTNET_KEY) {
            if (kw in keys) {
                this.key = 'testnet'
                this.network = bitcoin.networks.testnet
                this.ibdBlockHeight = 49000
                return
            }
        }
    }

}

export default new Network()

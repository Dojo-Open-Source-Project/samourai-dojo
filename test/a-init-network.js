/**
 * test/a-init-network.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import assert from 'assert'
import * as bitcoin from 'bitcoinjs-lib'
import network from '../lib/bitcoin/network.js'

network.key = 'testnet'
network.network = bitcoin.networks.testnet


/**
 * Force testnet for all the unit tests
 */
describe('InitTest', () => {

    describe('initTests()', () => {

        it('should successfully initialize testnet', () => {
            assert(true)
        })

    })

})

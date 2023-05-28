/*!
 * lib/bitcoin/parallel-address-derivation.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import { BIP32Factory } from 'bip32'
// eslint-disable-next-line import/no-unresolved
import * as ecc from 'tiny-secp256k1'
import workerPool from 'workerpool'

import errors from '../errors.js'
import network from './network.js'
import addrHelper from './addresses-helper.js'

const activeNet = network.network

const bip32 = BIP32Factory(ecc)

/**
 * Constants duplicated from HDAccountsHelper
 */
const BIP44 = 0
const BIP49 = 1
const BIP84 = 2

/**
 * @typedef {import('bip32').BIP32Interface} BIP32Interface
 */

/**
 * Derives an address for an hd account
 * @param {number} chain - chain to be derived
 *    must have a value on [0,1] for BIP44/BIP49/BIP84 derivation
 * @param {BIP32Interface} chainNode - Parent bip32 used for derivation
 * @param {number} index - index to be derived
 * @param {number} type - type of derivation
 * @returns {{ chain: number, index: number, address: string }} returns an address object
 */
function deriveAddress(chain, chainNode, index, type) {
    // Derive M/chain/index
    const indexNode = chainNode.derive(index)

    const addr = {
        chain: chain,
        index: index,
    }

    switch (type) {
    case BIP44:
        addr.address = addrHelper.p2pkhAddress(indexNode.publicKey)
        break
    case BIP49:
        addr.address = addrHelper.p2wpkhP2shAddress(indexNode.publicKey)
        break
    case BIP84:
        addr.address = addrHelper.p2wpkhAddress(indexNode.publicKey)
        break
    }

    return addr
}

/**
 * Derives a set of addresses for an hd account
 * @param {object} msg - parameters used for the derivation
 * @returns {{ status: 'ok', addresses: { chain: number, index: number, address: string }[]}}
 */
function deriveAddresses(msg) {
    try {
        const xpub = msg.xpub
        const chain = msg.chain
        const indices = msg.indices
        const type = msg.type
        const isPostmixChange = msg.isPostmixChange

        // Parse input as an HD Node. Throws if invalid
        const node = bip32.fromBase58(xpub, activeNet)

        // Check and see if this is a private key
        if (!node.isNeutered())
            throw errors.xpub.PRIVKEY

        const chainNode = node.derive(chain)

        const addresses = indices.map(index => {
            return deriveAddress(chain, chainNode, index, type)
        })

        // Generate additional change address types for postmix account
        if (isPostmixChange) {
            for (const index of indices) {
                addresses.push(deriveAddress(chain, chainNode, index, BIP44), deriveAddress(chain, chainNode, index, BIP49))
            }
        }

        // Send response to parent process
        return {
            status: 'ok',
            addresses: addresses
        }

    } catch (error) {
        return {
            status: 'error',
            addresses: [],
            error: JSON.stringify(error)
        }
    }
}

workerPool.worker({
    deriveAddresses: deriveAddresses
})

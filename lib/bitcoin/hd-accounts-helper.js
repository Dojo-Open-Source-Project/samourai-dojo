/*!
 * lib/bitcoin/hd-accounts-helper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { fileURLToPath } from 'url'
import path from 'path'
import QuickLRU from 'quick-lru'
import workerPool from 'workerpool'
import { BIP32Factory } from 'bip32'
// eslint-disable-next-line import/no-unresolved
import * as ecc from 'tiny-secp256k1'
import bs58check from 'bs58check'

import errors from '../errors.js'
import Logger from '../logger.js'
import network from './network.js'
import keysFile from '../../keys/index.js'
import addrHelper from './addresses-helper.js'

const activeNet = network.network
const keys = keysFile[network.key]

const bip32 = BIP32Factory(ecc)

const MAX_SAFE_INT_32 = Math.pow(2, 31) - 1

/**
 * @typedef {import('bip32').BIP32Interface} BIP32Interface
 */

/**
 * A singleton providing HD Accounts helper functions
 */
class HDAccountsHelper {

    /**
     * Constructor
     */
    constructor() {
        // HD accounts types
        this.BIP44 = 0
        this.BIP49 = 1
        this.BIP84 = 2
        this.LOCKED = 1 << 7

        // known HD accounts
        this.RICOCHET_ACCT = MAX_SAFE_INT_32
        this.POSTMIX_ACCT = MAX_SAFE_INT_32 - 1
        this.PREMIX_ACCT = MAX_SAFE_INT_32 - 2
        this.BADBANK_ACCT = MAX_SAFE_INT_32 - 3

        // Magic numbers
        this.MAGIC_XPUB = 0x0488B21E
        this.MAGIC_TPUB = 0x043587CF
        this.MAGIC_YPUB = 0x049D7CB2
        this.MAGIC_UPUB = 0x044A5262
        this.MAGIC_ZPUB = 0x04B24746
        this.MAGIC_VPUB = 0x045F1CF6

        // HD accounts cache
        this.nodes = new QuickLRU({
            // Maximum number of nodes to store in cache
            maxSize: 1000,
            // Maximum age for items in the cache. Items do not expire
            maxAge: Number.POSITIVE_INFINITY
        })

        // Default = external addresses derivation deactivated
        this.externalDerivationActivated = false
        this.derivationPool = null
    }

    /**
     * Activate external derivation of addresses
     * (provides improved performances)
     */
    activateExternalDerivation() {
        // Pool of child processes used for derivation of addresses
        const __filename = fileURLToPath(import.meta.url)
        const __dirname = path.dirname(__filename)
        const poolKeys = keys.addrDerivationPool

        this.derivationPool = workerPool.pool(
            `${__dirname}/parallel-address-derivation.js`,
            {
                maxWorkers: poolKeys.maxNbChildren,
                minWorkers: poolKeys.minNbChildren,
                workerType: 'thread'
            }
        )
        this.externalDerivationActivated = true
        Logger.info(`Created ${poolKeys.minNbChildren} worker threads for addresses derivation (max = ${poolKeys.maxNbChildren})`)
    }

    /**
     * Check if a string encodes a xpub/tpub
     * @param {string} xpub - extended public key to be checked
     * @returns {boolean} returns true if xpub encodes a xpub/tpub, false otherwise
     */
    isXpub(xpub) {
        return (xpub.indexOf('xpub') === 0) || (xpub.indexOf('tpub') === 0)
    }

    /**
     * Check if a string encodes a ypub/upub
     * @param {string} xpub - extended public key to be checked
     * @returns {boolean} returns true if xpub encodes a ypub/upub, false otherwise
     */
    isYpub(xpub) {
        return (xpub.indexOf('ypub') === 0) || (xpub.indexOf('upub') === 0)
    }

    /**
     * Check if a string encodes a zpub/vpub
     * @param {string} xpub - extended public key to be checked
     * @returns {boolean} returns true if xpub encodes a zpub/vpub, false otherwise
     */
    isZpub(xpub) {
        return (xpub.indexOf('zpub') === 0) || (xpub.indexOf('vpub') === 0)
    }

    /**
     * Translates
     *  - a xpub/ypub/zpub into a xpub
     *  - a tpub/upub/vpub into a tpub
     * @param {string} xpub - extended public key to be translated
     * @returns {string} returns the translated extended public key
     */
    xlatXPUB(xpub) {
        const decoded = bs58check.decode(xpub)
        const view = new DataView(decoded.buffer)
        const prefix = view.getUint32(0)

        if (prefix === this.MAGIC_XPUB || prefix === this.MAGIC_TPUB) return xpub

        if (prefix === this.MAGIC_YPUB || prefix === this.MAGIC_ZPUB) {
            view.setUint32(0, this.MAGIC_XPUB)
        } else if (prefix === this.MAGIC_UPUB || prefix === this.MAGIC_VPUB) {
            view.setUint32(0, this.MAGIC_TPUB)
        } else {
            throw errors.xpub.INVALID
        }

        return bs58check.encode(new Uint8Array(view.buffer))
    }

    /**
     * Classify the hd account type retrieved from db
     * @param {number} v - HD Account type (db encoding)
     * @returns {object} object storing the type and lock status of the hd account
     */
    classify(v) {
        const returnValue = {
            type: null,
            locked: false,
        }

        let p = v

        if (p >= this.LOCKED) {
            returnValue.locked = true
            p -= this.LOCKED
        }

        switch (p) {
        case this.BIP44:
        case this.BIP49:
        case this.BIP84:
            returnValue.type = p
            break
        }

        return returnValue
    }

    /**
     * Encode hd account type and lock status in db format
     * @param {number} type - HD Account type (db encoding)
     * @param {boolean} locked - lock status of the hd account
     * @returns {number}
     */
    makeType(type, locked) {
        let p =
            (type >= this.LOCKED)
                ? type - this.LOCKED
                : type

        locked = Boolean(locked)

        if (locked)
            p += this.LOCKED

        return p
    }

    /**
     * Return a string representation of the hd account type
     * @param {number} v - HD Account type (db encoding)
     * @returns {string}
     */
    typeString(v) {
        const info = this.classify(v)

        const prefix = info.locked ? 'LOCKED ' : ''

        let suffix = ''

        switch (info.type) {
        case this.BIP44:
            suffix = 'BIP44'
            break
        case this.BIP49:
            suffix = 'BIP49'
            break
        case this.BIP84:
            suffix = 'BIP84'
            break
        default:
            suffix = 'UNKNOWN'
            break
        }

        return prefix + suffix
    }

    /**
     * Checks if a hd account is a valid bip32
     * @param {string} xpub - hd account
     * @returns {boolean} returns true if hd account is valid, false otherwise
     */
    isValid(xpub) {
        if (this.nodes.has(xpub))
            return true

        try {
            if (!(this.isXpub(xpub) || this.isYpub(xpub) || this.isZpub(xpub))) {
                throw errors.xpub.INVALID
            }

            // Translate the xpub
            const xlatedXpub = this.xlatXPUB(xpub)

            // Parse input as an HD Node. Throws if invalid
            const node = bip32.fromBase58(xlatedXpub, activeNet)

            // Check and see if this is a private key
            if (!node.isNeutered())
                throw errors.xpub.PRIVKEY

            // Store the external and internal chain nodes in the proper indices.
            // Store the parent node as well, at index 2.
            this.nodes.set(xpub, [node.derive(0), node.derive(1), node])
            return true

        } catch (error) {
            if (error === errors.xpub.PRIVKEY) throw error
            return false
        }
    }

    /**
     * Get the hd node associated to an hd account
     * @param {string} xpub - hd account
     * @returns {[BIP32Interface, BIP32Interface, BIP32Interface]}
     */
    getNode(xpub) {
        return this.isValid(xpub) ? this.nodes.get(xpub) : null
    }

    /**
     * Derives an address for an hd account
     * @param {number} chain - chain to be derived
     *    must have a value on [0,1] for BIP44/BIP49/BIP84 derivation
     * @param {BIP32Interface} chainNode - Parent bip32 used for derivation
     * @param {number} index - index to be derived
     * @param {number} type - type of derivation
     * @returns {Promise<object>} returns an object {address: '...', chain: <int>, index: <int>, address: string }
     */
    async deriveAddress(chain, chainNode, index, type) {
        // Derive M/chain/index
        const indexNode = chainNode.derive(index)

        const addr = {
            chain: chain,
            index: index,
        }

        switch (type) {
        case this.BIP44:
            addr.address = addrHelper.p2pkhAddress(indexNode.publicKey)
            break
        case this.BIP49:
            addr.address = addrHelper.p2wpkhP2shAddress(indexNode.publicKey)
            break
        case this.BIP84:
            addr.address = addrHelper.p2wpkhAddress(indexNode.publicKey)
            break
        }

        return addr
    }

    /**
     * Derives addresses for an hd account
     * @param {string} xpub - hd account to be derived
     * @param {number} chain - chain to be derived
     *    must have a value on [0,1] for BIP44/BIP49/BIP84 derivation
     * @param {number[]} indices - array of indices to be derived
     * @param {number} type - type of derivation
     * @returns {Promise<{ chain: number, index: number, publicKey: Buffer, address: string }[]>} array of address objects
     */
    async deriveAddresses(xpub, chain, indices, type) {
        const node = this.getNode(xpub)

        if (node === null)
            throw errors.xpub.INVALID

        if (chain > 1 || chain < 0)
            throw errors.xpub.CHAIN

        if (!type)
            type = this.makeType(this.BIP44, false)

        const info = this.classify(type)

        // Node at M/chain
        const chainNode = node[chain]

        // Optimization: if number of addresses beyond a given treshold
        // derivation is done in a child process
        if (this.externalDerivationActivated && indices.length > keys.addrDerivationPool.thresholdParallelDerivation) {
            // Many addresses to be derived
            // Let's do it in a child process
            try {
                const data = {
                    xpub: this.xlatXPUB(xpub),
                    chain: chain,
                    indices: indices,
                    type: info.type,
                    isPostmixChange: this.isPostmixAcct(node) && chain === 1
                }

                const message = await this.derivationPool.exec('deriveAddresses', [data])

                if (message.status === 'ok') {
                    return message.addresses
                } else {
                    Logger.error(message.error, 'HdAccountsHelper : A problem was met during parallel addresses derivation')
                    return []
                }

            } catch (error) {
                Logger.error(error, 'HdAccountsHelper : A problem was met during parallel addresses derivation')
                throw error
            }
        } else {
            // Few addresses to be derived or external derivation deactivated
            // Let's do it here
            const promises = indices.map(index => {
                return this.deriveAddress(chain, chainNode, index, info.type)
            })

            // Generate additional change address types for postmix account
            if (this.isPostmixAcct(node) && chain === 1) {
                for (const index of indices) {
                    promises.push(this.deriveAddress(chain, chainNode, index, this.BIP44), this.deriveAddress(chain, chainNode, index, this.BIP49))
                }
            }

            const addresses = await Promise.all(promises)

            return addresses

        }
    }

    /**
     * @description Detect postmix account
     * @param {[BIP32Interface, BIP32Interface, BIP32Interface]} node - array of BIP32 node interfaces
     * @returns {boolean}
     */
    isPostmixAcct(node) {
        const index = node[2].index
        const threshold = Math.pow(2, 31)
        const hardened = (index >= threshold)
        const account = hardened ? (index - threshold) : index

        return account === this.POSTMIX_ACCT
    }

}

export default new HDAccountsHelper()

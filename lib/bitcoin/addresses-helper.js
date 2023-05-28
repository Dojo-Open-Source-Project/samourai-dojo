/*!
 * lib/bitcoin/addresses-helper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import * as ecc from 'tiny-secp256k1'
import bitcoin from 'bitcoinjs-lib'
import btcMessage from 'bitcoinjs-message'
import network from './network.js'
import Logger from '../logger.js'

bitcoin.initEccLib(ecc)

const activeNet = network.network
const { p2pkh, p2sh, p2wpkh, p2wsh, p2tr } = bitcoin.payments
const { OPS } = bitcoin.script


/**
 * A singleton providing Addresses helper functions
 */
class AddressesHelper {

    /**
     * Derives a P2PKH from a public key
     * @param {Buffer} pubKeyBuffer - Buffer storing a public key
     * @returns {string} return the derived address
     */
    p2pkhAddress(pubKeyBuffer) {
        return p2pkh({
            pubkey: pubKeyBuffer,
            network: activeNet,
        }).address
    }

    /**
     * Derives a P2WPKH-P2SH from a public key
     * @param {Buffer} pubKeyBuffer - Buffer storing a public key
     * @returns {string} return the derived address
     */
    p2wpkhP2shAddress(pubKeyBuffer) {
        return p2sh({
            redeem: p2wpkh({
                pubkey: pubKeyBuffer,
                network: activeNet,
            }),
            network: activeNet,
        }).address
    }

    /**
     * Derives a P2WPKH from a public key
     * @param {Buffer} pubKeyBuffer - Buffer storing a public key
     * @returns {string} return the derived address
     */
    p2wpkhAddress(pubKeyBuffer) {
        return p2wpkh({
            pubkey: pubKeyBuffer,
            network: activeNet,
        }).address.toLowerCase()
    }

    /**
     * Verify the signature of a given message
     * @param {string} msg - signed message
     * @param {string} address - address used to sign the message
     * @param {string} sig - signature of the message
     * @returns {boolean} retuns true if signature is valid, otherwise false
     */
    verifySignature(msg, address, sig) {
        try {
            const prefix = activeNet.messagePrefix
            return btcMessage.verify(msg, address, sig, prefix)
        } catch {
            return false
        }
    }

    /**
     * Checks if a string seems like a supported pubkey
     * @param {string} str - string
     * @returns {boolean} return true if str is a supported pubkey format, false otherwise
     */
    isSupportedPubKey(str) {
        return (str.length === 66 && (str.startsWith('02') || str.startsWith('03')))
    }

    /**
     * Check if string is a Bech32 address
     * @param {string} str - string to be checked
     * @returns {boolean} return true if str is a Bech32 address, false otherwise
     */
    isBech32(str) {
        try {
            bitcoin.address.fromBech32(str)
            return true
        } catch {
            return false
        }
    }

    /**
     * Get the script hash associated to a Bech32 address
     * @param {string} str - bech32 address
     * @returns {string | null} script hash in hex format
     */
    getScriptHashFromBech32(str) {
        try {
            return bitcoin.address.fromBech32(str).data.toString('hex')
        } catch (error) {
            Logger.error(error, 'AddressesHelper : getScriptHashFromBech32()')
            return null
        }
    }

    /**
     * Check if an output script is an OP_RETURN script
     * @param {Buffer} scriptpubkey - scriptpubkey
     * @returns {boolean} return true if output is a OP_RETURN script, otherwise return false
     */
    isOPReturnScript(scriptpubkey) {
        return scriptpubkey[0] === OPS.OP_RETURN
    }

    /**
     * Check if an output script is a P2PKH script
     * @param {Buffer} scriptpubkey - scriptpubkey
     * @returns {boolean} return true if output is a P2PKH script, otherwise return false
     */
    isP2pkhScript(scriptpubkey) {
        return scriptpubkey.length === 25
            && scriptpubkey[0] === OPS.OP_DUP
            && scriptpubkey[1] === OPS.OP_HASH160
            && scriptpubkey[2] === 0x14
            && scriptpubkey[23] === OPS.OP_EQUALVERIFY
            && scriptpubkey[24] === OPS.OP_CHECKSIG
    }

    /**
     * Check if an output script is a P2SH script
     * @param {Buffer} scriptpubkey - scriptpubkey
     * @returns {boolean} return true if output is a P2SH script, otherwise return false
     */
    isP2shScript(scriptpubkey) {
        return scriptpubkey.length === 23
            && scriptpubkey[0] === OPS.OP_HASH160
            && scriptpubkey[1] === 0x14
            && scriptpubkey[22] === OPS.OP_EQUAL
    }

    /**
     * Check if an output script is a P2WPKH script
     * @param {Buffer} scriptpubkey - scriptpubkey
     * @returns {boolean} return true if output is a P2WPKH script, otherwise return false
     */
    isP2wpkhScript(scriptpubkey) {
        return scriptpubkey.length === 22
            && scriptpubkey[0] === OPS.OP_0
            && scriptpubkey[1] === 0x14
    }

    /**
     * Check if an output script is a P2WSH script
     * @param {Buffer} scriptpubkey - scriptpubkey
     * @returns {boolean} return true if output is a P2WSH script, otherwise return false
     */
    isP2wshScript(scriptpubkey) {
        return scriptpubkey.length === 34
            && scriptpubkey[0] === OPS.OP_0
            && scriptpubkey[1] === 0x20
    }

    /**
     * Check if an output script is a P2TR script
     * @param {Buffer} scriptpubkey - scriptpubkey
     * @returns {boolean} return true if output is a P2TR script, otherwise return false
     */
    isP2trScript(scriptpubkey) {
        return scriptpubkey.length === 34
            && scriptpubkey[0] === OPS.OP_1
            && scriptpubkey[1] === 0x20
    }

    /**
     * Return the bitcoin address corresponding to an output script
     * @param {Buffer} scriptpubkey - scriptpubkey
     * @returns {string | null} bitcoin address or null
     */
    outputScript2Address(scriptpubkey) {
        try {
            if (this.isOPReturnScript(scriptpubkey))
                return null

            if (this.isP2pkhScript(scriptpubkey))
                return p2pkh({
                    output: scriptpubkey,
                    network: activeNet,
                }).address

            if (this.isP2shScript(scriptpubkey))
                return p2sh({
                    output: scriptpubkey,
                    network: activeNet,
                }).address

            if (this.isP2wpkhScript(scriptpubkey))
                return p2wpkh({
                    output: scriptpubkey,
                    network: activeNet,
                }).address

            if (this.isP2wshScript(scriptpubkey))
                return p2wsh({
                    output: scriptpubkey,
                    network: activeNet,
                }).address

            if (this.isP2trScript(scriptpubkey)) {
                return p2tr({
                    output: scriptpubkey,
                    network: activeNet
                }).address
            }
        } catch (error) {
            Logger.error(error, 'AddressesHelper : outputScript2Address()')
        }

        return null
    }
}

export default new AddressesHelper()

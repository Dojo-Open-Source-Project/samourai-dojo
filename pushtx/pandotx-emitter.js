/*!
 * pushtx/pandotx-emitter.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import bitcoin from 'bitcoinjs-lib'
import { RPC } from 'soroban-client-nodejs'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import errors from '../lib/errors.js'
import util from '../lib/util.js'


const keys = keysFile[network.key]


/**
 * A class processing the push of transactions over Soroban
 */
class PandoTxEmitter {

    constructor() {
        // Check if PandoTx is active
        if (keys['pandoTx']['push'] == 'inactive')
            return

        this.checkEmitTxs = null
        // Retrieve a few useful keys
        this.keyPush = keys['pandoTx']['keyPush']
        this.keyResults = keys['pandoTx']['keyResults']
        this.keyAnnounce = keys['pandoTx']['keyAnnounce']
        this.keySocks5Proxy = keys['pandoTx']['socks5Proxy']
        // Initialize a Soroban RPC client
        const sorobanUrl = keys['pandoTx']['sorobanUrl']
        const socks5ProxyUrl = (sorobanUrl.includes('.onion')) ?
            this.keySocks5Proxy :
            null
        this.sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl)
    }

    /**
     * Push transactions to the Bitcoin network through Soroban PandoTx
     * @param {string} rawtx - raw bitcoin transaction in hex format
     * @returns {string} returns the txid of the transaction
     */
    async emit(rawtx) {
        // Check if PandoTx is active
        if (keys['pandoTx']['push'] == 'inactive')
            return

        // Computes the txid of the transaction
        let txid = null
        try {
            const tx = bitcoin.Transaction.fromHex(rawtx)
            txid = tx.getId()
        } catch {
            throw errors.tx.PARSE
        }

        // Retrieve the list of public Soroban nodes
        const remoteNodes = await this.sorobanRpc.directoryList(this.keyAnnounce)
        if (remoteNodes == null || remoteNodes.length == 0)
            throw new Error('Not enough Soroban nodes found')
        
        // Select a random Soroban node and push the transaction over PandoTx
        const idx = Math.floor(Math.random() * remoteNodes.length)
        const entry = JSON.parse(remoteNodes[idx])
        if (!Object.hasOwn(entry, 'url')) {
            throw new Error(`Invalid Announce message: ${JSON.stringify(entry)}`)
        }
        
        const sorobanPushClient = new RPC(
            `${entry['url']}/rpc`, 
            this.keySocks5Proxy
        )
        await sorobanPushClient.directoryAdd(this.keyPush, rawtx, 'fast')
        
        // Wait for a confirmation
        const t0 = Date.now()
        while (true) {
            const entries = await this.sorobanRpc.directoryList(this.keyResults)
            // Check if txid found in confirmations
            if (entries != null && entries.length > 0) {
                for (const entry of entries) {
                    if (entry == txid) {
                        return txid
                    }
                }
            }
            // Return a failure if no response received after 15s
            const t1 = Date.now()
            if (t1-t0 > 15000) {
                throw new Error('Timeout: Failed to push transaction through PandoTx in less than 15s')
            }
            // Pause
            await util.delay(500)
        }
    }

}

export default PandoTxEmitter


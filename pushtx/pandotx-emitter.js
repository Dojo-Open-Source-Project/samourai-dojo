/*!
 * pushtx/pandotx-emitter.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import bitcoin from 'bitcoinjs-lib'
import { RPC, RPCCallError } from 'soroban-client-nodejs'
import Logger from '../lib/logger.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import errors from '../lib/errors.js'
import util from '../lib/util.js'


const keys = keysFile[network.key]


/**
 * A class processing the push of transactions over Soroban
 */
class PandoTxEmitter {

    constructor(rpcClient) {
        this.rpcClient = rpcClient
        // Check if PandoTx is active
        if (keys['pandoTx']['push'] == 'inactive')
            return
        // Retrieve a few useful keys
        this.keyPush = keys['pandoTx']['keyPush']
        this.keyResults = keys['pandoTx']['keyResults']
        this.keyAnnounce = keys['soroban']['keyAnnounce']
        this.keySocks5Proxy = keys['soroban']['socks5Proxy']
        this.maxNbAttempts = keys['pandoTx']['nbRetries'] + 1
        // Initialize a Soroban RPC client
        const sorobanUrl = keys['soroban']['rpc']
        const socks5ProxyUrl = (sorobanUrl.includes('.onion')) ?
            this.keySocks5Proxy :
            null
        this.sorobanRpc = new RPC(sorobanUrl, socks5ProxyUrl)
        // Initialize PandoTx watchdog attributes
        this.isWatchdogActive = false
        this.watchdogTxsList = []
        this.watchdogBlacklist = new Map()
        this.checkWatchdog = null
    }

    /**
     * Start the emitter
     * @returns {Promise}
     */
    start() {
        // Start the watchdog loop
        this.watchdogLoop = setInterval(
            () => this.processWatchdog(),
            10000
        )
    }

    /**
     * Stop the emitter
     */
    async stop() {
        // Process the watchdog one more time
        await this.processWatchdog()
        // Stop the watchdog loop
        clearInterval(this.watchdogLoop)
    }

    /**
     * Push transactions to the Bitcoin network through Soroban PandoTx
     * @param {string} rawtx - raw bitcoin transaction in hex format
     * @param {boolean} retry - should emission be retried until success?
     * @returns {string} returns the txid of the transaction
     */
    async emit(rawtx, retry=false) {
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

        // Prepare an array of remote Soroban node urls
        let url = null
        let remoteNodes = await this.sorobanRpc.directoryList(this.keyAnnounce)
        if (remoteNodes == null || remoteNodes.length == 0)
            throw new Error('No available Soroban node found')
        // Extract the urls from the announcement messages
        let urls = remoteNodes.map((n) => {
            const o = JSON.parse(n)
            if (Object.hasOwn(o, 'url')) {
                return o['url']
            }
        });
        // Remove duplicate urls
        urls = [...new Set(urls)]

        // We will try a few times in case of failure
        let counter = this.maxNbAttempts

        while (counter > 0) {
            // Select a random 'honest' Soroban node
            while (url == null) {
                if (urls == null || urls.length == 0)
                    throw new Error('No available Soroban node found')

                // Select a random url
                const idx = Math.floor(Math.random() * urls.length)
                url = urls[idx]

                if (this.watchdogBlacklist.has(url)) {
                    // Check if blacklisting has expired (>24h)
                    const delta = Date.now() - this.watchdogBlacklist.get(url)
                    if (delta < 86400000) {
                        urls.splice(idx, 1)
                        url = null
                        continue
                    } else {
                        this.watchdogBlacklist.delete(url)
                    }
                }
            }
            
            counter--

            // Push the transaction over PandoTx
            let addedToDirectory = true
            try {
                // Last attempt: push on local soroban node
                if (counter == 0) {
                    // Local push
                    await this.sorobanRpc.directoryAdd(this.keyPush, rawtx, 'fast')
                } else {
                    // Remote push
                    const sorobanPushClient = new RPC(
                        `${url}/rpc`, 
                        this.keySocks5Proxy
                    )
                    await sorobanPushClient.directoryAdd(this.keyPush, rawtx, 'fast')
                }
            } catch (e) {
                if (e instanceof RPCCallError) {
                    if (e.message.includes('Socks5 proxy rejected connection')) {
                        // Blacklist the soroban node 
                        this.watchdogBlacklist.set(url, Date.now())
                        Logger.info(`PandoTx : Blacklisted Soroban node ${url} (not responding)`)
                    } else if (e.message.includes('Proxy connection timed out')) {
                        // Blacklist the soroban node 
                        this.watchdogBlacklist.set(url, Date.now())
                        Logger.info(`PandoTx : Blacklisted Soroban node ${url} (connection timeout)`)
                    }
                }
                addedToDirectory = false
            }
            
            if (!addedToDirectory)
                continue

            // Wait for a confirmation
            const t0 = Date.now()
            while (true) {
                const confirmations = await this.sorobanRpc.directoryList(this.keyResults)
                // Check if txid found in confirmations
                if (confirmations != null && confirmations.length > 0) {
                    for (const confirmation of confirmations) {
                        if (confirmation == txid) {
                            // Add an entry to watchdogTxsList 
                            this.watchdogTxsList.push({
                                'tx': rawtx,
                                'txid': txid,
                                'node': url,
                                'ts': Date.now()
                            })
                            Logger.info(`PandoTx : Successfully pushed tx ${txid} through Soroban node ${url}`)
                            return txid
                        }
                    }
                }
                // Return a failure if no response received after 15s
                const t1 = Date.now()
                if (t1-t0 > 15000) {
                    this.watchdogBlacklist.set(url, Date.now())
                    Logger.info(`PandoTx : Blacklisted Soroban node ${url} (timeout)`)
                    if (retry) {
                        return await this.emit(rawtx, retry)
                    } else {
                        throw new Error(`Timeout: Failed to push tx ${txid} through Soroban node ${url} in less than 15s`)
                    }
                }
                // Pause
                await util.delay(500)
            }
        }
        // Failed to push the transaction after a given number of attempts
        throw new Error(`Failed to push tx ${txid} through Soroban after ${this.maxNbAttempts} attempts`)
    }

    /**
     * Run a watchdog checking that pushed transactions are seen by the local bitcoind
     * Manages a blacklist of malicious Soroban nodes
     */
    async processWatchdog() {
        // Prevent multiple watchdogs at the same time (for long processings)
        if (this.isWatchdogActive)
            return


        try {
            this.isWatchdogActive = true
            for (let i=this.watchdogTxsList.length-1; i>=0; i--) {
                const entry = this.watchdogTxsList[i]
                const now = Date.now()
                if (now - entry['ts'] >= 30000) {
                    // Check if transaction is known by local bitcoind after 30s
                    let txid = entry['txid']
                    try {
                        await this.rpcClient.getrawtransaction({
                            txid, 
                            verbose: false 
                        })
                        // Remove the transaction from the list
                        this.watchdogTxsList.splice(i, 1)
                    } catch (error) {
                        // Blacklist the faulty soroban node
                        this.watchdogBlacklist.set(entry['node'], Date.now())
                        Logger.info(`PandoTx : Blacklisted misbehaving Soroban node ${entry['node']}`)
                        // Remove the transaction from the list
                        this.watchdogTxsList.splice(i, 1)
                        // Emit the transaction again
                        Logger.info(`PandoTx : Transaction ${txid} not seen by local bitcoind after 30s. A new emission is going to be processed.`)
                        await this.emit(entry['tx'], true)
                    }
                }
            }
        } catch (e) {
            throw e
        } finally {
            this.isWatchdogActive = false
        }
    }

}

export default PandoTxEmitter


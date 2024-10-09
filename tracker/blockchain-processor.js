/*!
 * tracker/blockchain-processor.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import zmq from 'zeromq/v5-compat.js'
import { Sema } from 'async-sema'
import bitcoin from 'bitcoinjs-lib'

import util from '../lib/util.js'
import { FifoQueue } from '../lib/queue.js'
import Logger from '../lib/logger.js'
import db from '../lib/db/mysql-db-wrapper.js'
import network from '../lib/bitcoin/network.js'
import { createRpcClient, waitForBitcoindRpcApi } from '../lib/bitcoind-rpc/rpc-client.js'
import keysFile from '../keys/index.js'
import Block from './block.js'

const keys = keysFile[network.key]

/**
 * @typedef {{ height: number, hash: string, time: number, previousblockhash: string }} BlockHeader
 */

/**
 * A class allowing to process the blockchain
 */
class BlockchainProcessor {

    /**
     * Constructor
     * @param {object} notifSock - ZMQ socket used for notifications
     */
    constructor(notifSock) {
        // RPC client
        this.client = createRpcClient()
        // ZeroMQ socket for bitcoind blocks messages
        this.blkSock = null
        // Initialize a semaphor protecting the onBlockHash() method
        this._onBlockHashSemaphor = new Sema(1, { capacity: 50 })
        // Flag tracking Initial Block Download Mode
        this.isIBD = true
        // Instance of ZMQ notification socket
        this.notifSock = notifSock
    }

    /**
     * Start processing the blockchain
     * @returns {Promise<void>}
     */
    async start() {
        await this.catchup()
        await this.initSockets()
    }

    /**
     * Start processing the blockchain
     */
    async stop() {
        this.blkSock && this.blkSock.close()
    }

    /**
     * Tracker process startup
     * @returns {Promise<void>}
     */
    async catchup() {
        try {
            await waitForBitcoindRpcApi()
            const [highest, info] = await Promise.all([db.getHighestBlock(), this.client.getblockchaininfo()])
            const daemonNbHeaders = info.headers

            // Consider that we are in IBD mode if Dojo is far in the past (> 13,000 blocks)
            this.isIBD = (highest.blockHeight < network.ibdBlockHeight) || (highest.blockHeight < daemonNbHeaders - 13000)

            return this.isIBD ? this.catchupIBDMode() : this.catchupNormalMode()
        } catch (error) {
            Logger.error(error, 'Tracker : BlockchainProcessor.catchup()')
            await util.delay(2000)
            return this.catchup()
        }
    }

    /**
     * Tracker process startup (normal mode)
     * 1. Grab the latest block height from the daemon
     * 2. Pull all block headers after database last known height
     * 3. Process those block headers
     *
     * @returns {Promise<void>}
     */
    async catchupIBDMode() {
        try {
            Logger.info('Tracker : Tracker Startup (IBD mode)')

            // Get highest block processed by the tracker
            const [highest, info] = await Promise.all([db.getHighestBlock(), this.client.getblockchaininfo()])
            const daemonNbBlocks = info.blocks
            const daemonNbHeaders = info.headers

            const dbMaxHeight = highest.blockHeight
            let previousBlockId = highest.blockID

            // If no header or block loaded by bitcoind => try later
            if (daemonNbHeaders === 0 || daemonNbBlocks === 0) {
                Logger.info('Tracker : New attempt scheduled in 30s (waiting for block headers)')
                await util.delay(30000)

                return this.catchupIBDMode()

                // If we have more blocks to load in db
            } else if (daemonNbHeaders - 1 > dbMaxHeight) {

                // If blocks need to be downloaded by bitcoind => try later
                if (daemonNbBlocks - 1 <= dbMaxHeight) {
                    Logger.info('Tracker : New attempt scheduled in 10s (waiting for blocks)')
                    await util.delay(10000)

                    return this.catchupIBDMode()

                    // If some blocks are ready for an import in db
                } else {
                    const blockRange = util.range(dbMaxHeight + 1, daemonNbBlocks + 1)

                    Logger.info(`Tracker : Sync ${blockRange.length} blocks`)

                    // create a FIFO queue instance that will process block headers as they arrive
                    const headerQueue = new FifoQueue(async (header) => {
                        try {
                            // eslint-disable-next-line require-atomic-updates
                            previousBlockId = await this.processBlockHeader(header, previousBlockId)
                        } catch (error) {
                            Logger.error(error, 'Tracker : BlockchainProcessor.catchupIBDMode()')
                            process.exit()
                        }
                    }, 10000)

                    // cut block range into chunks of 40 items
                    const blockRangeChunks = util.splitList(blockRange, 40)

                    for (const blockRangeChunk of blockRangeChunks) {
                        // wait until block header queue length is under high watermark
                        await headerQueue.waitOnWaterMark()

                        // process bitcoin RPC requests in a pool of 4 tasks at once
                        const headers = await util.asyncPool(4, blockRangeChunk, async (height) => {
                            try {
                                const blockHash = await this.client.getblockhash({ height })
                                return await this.client.getblockheader({ blockhash: blockHash, verbose: true })
                            } catch (error) {
                                Logger.error(error, 'Tracker : BlockchainProcessor.catchupIBDMode()')
                                process.exit()
                            }
                        })

                        headerQueue.push(...headers)
                    }

                    // wait until block header queue is processed
                    await headerQueue.waitOnFinished()

                    // Schedule a new iteration (in case more blocks need to be loaded)
                    Logger.info('Tracker : Start a new iteration')
                    return this.catchupIBDMode()
                }

                // If we are synced
            } else {
                this.isIBD = false
            }

        } catch (error) {
            Logger.error(error, 'Tracker : BlockchainProcessor.catchupIBDMode()')
            throw error
        }
    }

    /**
     * Tracker process startup (normal mode)
     * 1. Grab the latest block height from the daemon
     * 2. Pull all block headers after database last known height
     * 3. Process those block headers
     *
     * @returns {Promise<void>}
     */
    async catchupNormalMode() {
        try {
            Logger.info('Tracker : Tracker Startup (normal mode)')

            // Get highest block processed by the tracker
            const [highest, info] = await Promise.all([db.getHighestBlock(), this.client.getblockchaininfo()])
            const daemonNbBlocks = info.blocks

            if (daemonNbBlocks === highest.blockHeight) return null

            const blockRange = util.range(highest.blockHeight, daemonNbBlocks + 1)

            Logger.info(`Tracker : Sync ${blockRange.length} blocks`)

            try {
                return this.processBlockRange(blockRange)
            } catch (error) {
                Logger.error(error, 'Tracker : BlockchainProcessor.catchupNormalMode()')
                process.exit()
            }

        } catch (error) {
            Logger.error(error, 'Tracker : BlockchainProcessor.catchupNormalMode()')
        }
    }

    /**
     * Initialiaze ZMQ sockets
     */
    initSockets() {
        // Socket listening to bitcoind Blocks messages
        this.blkSock = zmq.socket('sub')
        this.blkSock.connect(keys.bitcoind.zmqBlk)
        this.blkSock.subscribe('hashblock')

        this.blkSock.on('message', (topic, message) => {
            switch (topic.toString()) {
            case 'hashblock':
                this.onBlockHash(message)
                break
            default:
                Logger.info(`Tracker : ${topic.toString()}`)
            }
        })

        Logger.info('Tracker : Listening for blocks')
    }

    /**
     * Upon receipt of a new block hash, retrieve the block header from bitcoind via
     * RPC. Continue pulling block headers back through the chain until the database
     * contains header.previousblockhash, adding the headers to a stack. If the
     * previousblockhash is not found on the first call, this is either a chain
     * re-org or the tracker missed blocks during a shutdown.
     *
     * Once the chain has bottomed out with a known block in the database, delete
     * all known database transactions confirmed in blocks at heights greater than
     * the last known block height. These transactions are orphaned but may reappear
     * in the new chain. Notify relevant accounts of balance updates /
     * transaction confirmation counts.
     *
     * Delete block entries not on the main chain.
     *
     * Forward-scan through the block headers, pulling the full raw block hex via
     * RPC. The raw block contains all transactions and is parsed by bitcoinjs-lib.
     * Add the block to the database. Run checkTransaction for each transaction in
     * the block that is not in the database. Confirm all transactions in the block.
     *
     * After each block, query bitcoin against all database unconfirmed outputs
     * to see if they remain in the mempool or have been confirmed in blocks.
     * Malleated transactions entering the wallet will disappear from the mempool on
     * block confirmation.
     *
     * @param {Buffer} buf - block
     * @returns {Promise<void>}
     */
    async onBlockHash(buf) {
        try {
            // Acquire the semaphor
            await this._onBlockHashSemaphor.acquire()

            const blockHash = buf.toString('hex')
            let headers = null

            try {
                const header = await this.client.getblockheader({ blockhash: blockHash, verbose: true })
                Logger.info(`Tracker : Block #${header.height} ${blockHash}`)
                // Grab all headers between this block and last known
                headers = await this.chainBacktrace([header])
            } catch (error) {
                Logger.error(error, `Tracker : BlockchainProcessor.onBlockHash() : error in getblockheader(${blockHash})`)
            }

            if (headers == null)
                return null

            // Reverse headers to put oldest first
            headers.reverse()

            const deepest = headers[0]
            const knownHeight = deepest.height - 1

            // Cancel confirmation of transactions
            // and delete blocks after the last known block height
            await this.rewind(knownHeight)

            const heights = headers.map((header) => header.height)

            // Process the blocks
            return await this.processBlockRange(heights)
        } catch (error) {
            Logger.error(error, 'Tracker : BlockchainProcessor.onBlockHash()')
        } finally {
            // Release the semaphor
            await this._onBlockHashSemaphor.release()
        }
    }

    /**
     * Zip back up the blockchain until a known prevHash is found, returning all
     * block headers from last header in the array to the block after last known.
     * @param {BlockHeader[]} headers - array of block headers
     * @returns {Promise<any[]>}
     */
    async chainBacktrace(headers) {
        // Block deepest in the blockchain is the last on the list
        const deepest = headers.at(-1)

        if (headers.length > 1)
            Logger.info(`Tracker : chainBacktrace @ height ${deepest.height}, ${headers.length} blocks`)

        // reached the genesis block
        if (!deepest.previousblockhash) return headers

        // Look for previous block in the database
        const block = await db.getBlockByHash(deepest.previousblockhash)

        if (block == null) {
            // Previous block does not exist in database. Grab from bitcoind
            const header = await this.client.getblockheader({ blockhash: deepest.previousblockhash, verbose: true })
            headers.push(header)
            return this.chainBacktrace(headers)
        } else {
            // Previous block does exist. Return headers
            return headers
        }
    }

    /**
     * Cancel confirmation of transactions
     * and delete blocks after a given height
     * @param {number} height - height of last block maintained
     * @returns {Promise<void>}
     */
    async rewind(height) {
        // Retrieve transactions confirmed in reorg'd blocks
        const txs = await db.getTransactionsConfirmedAfterHeight(height)

        if (txs.length > 0) {
            // Cancel confirmation of transactions included in reorg'd blocks
            Logger.info(`Tracker : Backtrace: unconfirm ${txs.length} transactions in reorg`)
            const txids = txs.map(t => t.txnTxid)
            const txidsPool = util.splitList(txids, 1000)
            await util.asyncPool(10, txidsPool, (txidList) => db.unconfirmTransactions(txidList))
        }

        await db.deleteBlocksAfterHeight(height)
    }

    /**
     * Rescan a range of blocks
     * @param {number} fromHeight - height of first block
     * @param {number} toHeight - height of last block
     * @returns {Promise<any[]>}
     */
    async rescanBlocks(fromHeight, toHeight) {
        // Get highest block processed by the tracker
        const highest = await db.getHighestBlock()
        const dbMaxHeight = highest.blockHeight

        if (toHeight == null)
            toHeight = fromHeight

        toHeight = Math.min(toHeight, dbMaxHeight)
        const blockRange = util.range(fromHeight, toHeight + 1)

        Logger.info(`Blocks Rescan : starting a rescan for ${blockRange.length} blocks`)

        try {
            return this.processBlockRange(blockRange)
        } catch (error) {
            Logger.error(error, 'Tracker : BlockchainProcessor.rescan()')
            throw error
        }
    }

    /**
     * Process a range of blocks
     * @param {number[]} heights - a range of block heights
     * @returns {Promise<void>}
     */
    async processBlockRange(heights) {
        // Init a processing queue with maximum number of 500 items
        const blocksQueue = new FifoQueue(async (block) => {
            const txsForBroadcast = await block.processBlock()

            for (const tx of txsForBroadcast) {
                this.notifSock.send(['transaction', tx.getId()])
            }

            this.notifSock.send(['block', JSON.stringify({ height: block.header.height, hash: block.header.hash })])
        }, 500)

        // cut block range into chunks of 10 items
        const blockRangeChunks = util.splitList(heights, 10)

        for (const blockRangeChunk of blockRangeChunks) {
            // wait until block queue length is under high watermark
            await blocksQueue.waitOnWaterMark()

            // process bitcoin RPC requests in a pool of 4 tasks at once
            const blocks = await util.asyncPool(4, blockRangeChunk, async (height) => {
                try {
                    const hash = await this.client.getblockhash({ height })
                    const hex = await this.client.getblock({ blockhash: hash, verbosity: 0 })
                    const block = bitcoin.Block.fromHex(hex)
                    return new Block({
                        height: height,
                        time: block.timestamp,
                        hash: block.getId(),
                        previousblockhash: Buffer.from(block.prevHash.reverse()).toString('hex')
                    }, block.transactions)
                } catch (error) {
                    Logger.error(error, 'Tracker : BlockchainProcessor.processBlockRange()')
                    process.exit()
                }
            })

            blocksQueue.push(...blocks)
        }

        // wait until block queue is processed
        await blocksQueue.waitOnFinished()
    }

    /**
     * Process a block header
     * @param {BlockHeader} header - block header
     * @param {number} prevBlockID - id of previous block
     * @returns {Promise<number>}
     */
    processBlockHeader(header, prevBlockID) {
        try {
            const block = new Block(header, null)
            return block.checkBlockHeader(prevBlockID)
        } catch (error) {
            Logger.error(error, 'Tracker : BlockchainProcessor.processBlockHeader()')
            throw error
        }
    }

}

export default BlockchainProcessor

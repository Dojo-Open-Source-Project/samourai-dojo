/*!
 * lib/bitcoind_rpc/latest-block.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import zmq from 'zeromq/v5-compat.js'

import Logger from '../logger.js'
import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import { createRpcClient, waitForBitcoindRpcApi } from './rpc-client.js'
import util from '../util.js'

const keys = keysFile[network.key]

/**
 * A singleton providing information about the latest block
 */
class LatestBlock {

    /**
     * Constructor
     */
    constructor() {
        this.height = null
        this.hash = null
        this.time = null
        this.diff = null

        // Initialize the rpc client
        this.rpcClient = createRpcClient()

        waitForBitcoindRpcApi().then(() => {
            // Gets the latest block from bitcoind
            this.rpcClient.getbestblockhash().then((hash) => this.onBlockHash(hash))
        })

        // Initializes zmq socket
        this.sock = zmq.socket('sub')
        this.sock.connect(keys.bitcoind.zmqBlk)
        this.sock.subscribe('hashblock')

        this.sock.on('message', async (topic, message) => {
            switch (topic.toString()) {
            case 'hashblock':
                await this.onBlockHash(message.toString('hex'))
                break
            default:
                Logger.info(`Bitcoind RPC : ${topic.toString()}`)
            }
        })
    }

    /**
     * Retrieve and store information for a given block
     * @param {string} hash - txid of the block
     * @returns {Promise}
     */
    async onBlockHash(hash) {
        try {
            const header = await this.rpcClient.getblockheader({ blockhash: hash })

            this.height = header.height
            this.hash = hash
            this.time = header.mediantime
            this.diff = header.difficulty

            Logger.info(`Bitcoind RPC : Block ${this.height} ${this.hash}`)
        } catch (error) {
            Logger.error(error, 'Bitcoind RPC : LatestBlock.onBlockHash()')
            await util.delay(2000)
            return this.onBlockHash(hash)
        }
    }

}

export default new LatestBlock()

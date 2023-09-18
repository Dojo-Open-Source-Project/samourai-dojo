/*!
 * scripts/tracker.index.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import Logger from '../lib/logger.js'
import BlockchainProcessor from '../tracker/blockchain-processor.js'
import db from '../lib/db/mysql-db-wrapper.js'
import keysFile from '../keys/index.js'
import network from '../lib/bitcoin/network.js'

const keys = keysFile[network.key]


/**
 * Script executing a rescan of the chain from a given block
 */

async function run(height) {
    const dbConfig = {
        connectionLimit: keys.db.connectionLimitTracker,
        acquireTimeout: keys.db.acquireTimeout,
        host: keys.db.host,
        user: keys.db.user,
        password: keys.db.pass,
        database: keys.db.database
    }

    db.connect(dbConfig)

    const processor = new BlockchainProcessor({ send: () => {} })
    // Rewind the chain
    await processor.rewind(height - 1)
    // Catchup
    await processor.catchupNormalMode()
}


/**
 * Launch the script
 */

// Retrieves command line arguments
if (process.argv.length < 3) {
    Logger.error(null, 'Missing arguments. Command = node rescan-blocks.js <from_block_height>')
    process.exit(1)
}

Logger.info('Start processing')

const height = Number.parseInt(process.argv[2], 10)

setTimeout(async () => {
    return run(height).then(() => {
        Logger.info('Process completed')
    })
}, 1500)

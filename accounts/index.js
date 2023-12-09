/*!
 * accounts/index.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import Logger from '../lib/logger.js'
import { waitForBitcoindRpcApi } from '../lib/bitcoind-rpc/rpc-client.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import db from '../lib/db/mysql-db-wrapper.js'
import hdaHelper from '../lib/bitcoin/hd-accounts-helper.js'
import HttpServer from '../lib/http-server/http-server.js'
import AuthRestApi from '../lib/auth/auth-rest-api.js'
import XPubRestApi from './xpub-rest-api.js'
import FeesRestApi from './fees-rest-api.js'
import HeadersRestApi from './headers-rest-api.js'
import TransactionsRestApi from './transactions-rest-api.js'
import StatusRestApi from './status-rest-api.js'
import notifServer from './notifications-server.js'
import WalletRestApi from './wallet-rest-api.js'
import MultiaddrRestApi from './multiaddr-rest-api.js'
import UnspentRestApi from './unspent-rest-api.js'
import SupportRestApi from './support-rest-api.js'
import SeenRestApi from './seen-rest-api.js'

const keys = keysFile[network.key]


try {
    /**
     * Samourai REST API
     */
    Logger.info(`API : Process ID: ${process.pid}`)
    Logger.info('API : Preparing the REST API')

    // Wait for Bitcoind RPC API
    // being ready to process requests
    await waitForBitcoindRpcApi()

    // Initialize the db wrapper
    const dbConfig = {
        connectionLimit: keys.db.connectionLimitApi,
        acquireTimeout: keys.db.acquireTimeout,
        host: keys.db.host,
        user: keys.db.user,
        password: keys.db.pass,
        database: keys.db.database
    }

    db.connect(dbConfig)

    // Activate addresses derivation
    // in an external process
    hdaHelper.activateExternalDerivation()

    // Initialize the http server
    const host = keys.apiBind
    const port = keys.ports.account
    const httpServer = new HttpServer(port, host)

    // Initialize the rest api endpoints
    new AuthRestApi(httpServer)
    new XPubRestApi(httpServer)
    new FeesRestApi(httpServer)
    new HeadersRestApi(httpServer)
    new TransactionsRestApi(httpServer)
    new StatusRestApi(httpServer)
    new WalletRestApi(httpServer)
    new MultiaddrRestApi(httpServer)
    new UnspentRestApi(httpServer)
    new SupportRestApi(httpServer)
    new SeenRestApi(httpServer)

    // Start the http server
    httpServer.start()

    // Attach the web sockets server to the web server
    notifServer.attach(httpServer)

    // Signal that the process is ready
    process.send('ready')

    const exit = async () => {
        httpServer.stop()
        notifServer.close()
        await db.disconnect()
        process.exit(0)
    }

    process.on('SIGTERM', async () => {
        await exit()
    })

    process.on('SIGINT', async () => {
        await exit()
    })

} catch (error) {
    Logger.error(error, 'Accounts : Unhandled error, exiting...')
    process.exit(1)
}

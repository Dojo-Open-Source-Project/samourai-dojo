/*!
 * accounts/seen-rest-api.js
 * Copyright © 2023 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import Logger from '../lib/logger.js'
import authMgr from '../lib/auth/authorizations-manager.js'
import HttpServer from '../lib/http-server/http-server.js'
import rpcLatestBlock from '../lib/bitcoind-rpc/latest-block.js'

const debugApi = process.argv.includes('api-debug')

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */

/**
 * Headers API endpoints
 */
class LatestBlockRestApi {

    /**
     * Constructor
     * @param {HttpServer} httpServer - HTTP server
     */
    constructor(httpServer) {
        this.httpServer = httpServer

        // Establish routes
        this.httpServer.app.get(
            '/latest-block',
            authMgr.checkAuthentication.bind(authMgr),
            this.getLatestBlock.bind(this),
        )
    }

    /**
     * Handle /latest-block GET request
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     */
    async getLatestBlock(req, res) {
        const latestBlock = {
            height: rpcLatestBlock.height,
            hash: rpcLatestBlock.hash,
            time: rpcLatestBlock.time,
        }

        HttpServer.sendOkDataOnly(res, latestBlock)

        if (debugApi) {
            Logger.info('API : Completed GET /latest-block')
        }
    }

}

export default LatestBlockRestApi

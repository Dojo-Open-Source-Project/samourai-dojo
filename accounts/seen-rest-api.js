/*!
 * accounts/seen-rest-api.js
 * Copyright © 2023 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import Logger from '../lib/logger.js'
import errors from '../lib/errors.js'
import authMgr from '../lib/auth/authorizations-manager.js'
import HttpServer from '../lib/http-server/http-server.js'
import network from '../lib/bitcoin/network.js'
import keysFile from '../keys/index.js'
import remoteImporter from '../lib/remote-importer/remote-importer.js'

const keys = keysFile[network.key]

const debugApi = process.argv.includes('api-debug')

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */

/**
 * Headers API endpoints
 */
class SeenRestApi {

    /**
     * Constructor
     * @param {HttpServer} httpServer - HTTP server
     */
    constructor(httpServer) {
        this.httpServer = httpServer

        // Establish routes
        this.httpServer.app.get(
            '/seen',
            authMgr.checkAuthentication.bind(authMgr),
            this.validateArgsGetSeen.bind(this),
            this.getSeen.bind(this),
        )
    }

    /**
     * Handle /seen GET request
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     */
    async getSeen(req, res) {
        try {
            const addresses = req.query.addresses.split('|')

            const addrResult = await remoteImporter.sources.getAddresses(addresses, false)

            const result = {}

            for (const addr of addrResult) {
                result[addr.address] = addr.ntx > 0
            }

            HttpServer.sendOkDataOnly(res, result)
        } catch (error) {
            HttpServer.sendError(res, error)
        } finally {
            if (debugApi) {
                const stringParameters = `${req.query.addresses || ''}`

                Logger.info(`API : Completed GET /seen ${stringParameters}`)
            }
        }
    }

    /**
     * Validate request arguments
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     * @param {NextFunction} next - next tiny-http middleware
     */
    validateArgsGetSeen(req, res, next) {
        if (keys.indexer.active === 'local_bitcoind') {
            return HttpServer.sendError(res, errors.multiaddr.NO_IMPORTER)
        }

        if (!req.query.addresses || typeof req.query.addresses !== 'string') {
            return HttpServer.sendError(res, errors.multiaddr.INVALID)
        }

        next()
    }

}

export default SeenRestApi

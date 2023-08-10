/*!
 * accounts/get-fees-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import Logger from '../lib/logger.js'
import rpcFees from '../lib/bitcoind-rpc/fees.js'
import authMgr from '../lib/auth/authorizations-manager.js'
import HttpServer from '../lib/http-server/http-server.js'

const debugApi = process.argv.includes('api-debug')


/**
 * A singleton providing util methods used by the API
 */
class FeesRestApi {

    /**
     * Constructor
     * @param {HttpServer} httpServer - HTTP server
     */
    constructor(httpServer) {
        this.httpServer = httpServer
        // Establish routes
        this.httpServer.app.get(
            '/fees',
            authMgr.checkAuthentication.bind(authMgr),
            this.getFees,
        )
        this.httpServer.app.post(
            '/fees',
            authMgr.checkAuthentication.bind(authMgr),
            this.getFees,
        )
        this.httpServer.app.get(
            '/fees/estimator',
            authMgr.checkAuthentication.bind(authMgr),
            this.getEstimatorFees,
        )
        // Refresh the network fees
        rpcFees.refresh()
    }

    /**
     * Refresh and return the current fees
     * @param {object} req - http request object
     * @param {object} res - http response object
     */
    async getFees(req, res) {
        try {
            const fees = await rpcFees.getFees()
            HttpServer.sendOkDataOnly(res, fees)
        } catch (error) {
            HttpServer.sendError(res, error)
        } finally {
            debugApi && Logger.info('API : Completed GET /fees')
        }
    }

    /**
     * Get fees from $1 Fee Estimator
     * @param {object} req - http request object
     * @param {object} res - http response object
     */
    getEstimatorFees(req, res) {
        try {
            const fees = rpcFees.getEstimatorFees()
            HttpServer.sendOkDataOnly(res, fees)
        } catch (error) {
            HttpServer.sendError(res, error, 503)
        }
    }

}

export default FeesRestApi

/*!
 * lib/auth/auth-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { execSync } from 'child_process'
import path from 'path'
import crypto from 'crypto'
import QuickLRU from 'quick-lru'
// eslint-disable-next-line import/no-unresolved
import { urlencoded, json } from 'milliparsec'
// eslint-disable-next-line import/no-unresolved
import { Auth47Verifier } from '@samouraiwallet/auth47'
import * as ecc from 'tiny-secp256k1'

import HttpServer from '../http-server/http-server.js'
import authentMgr from './authentication-manager.js'
import authorzMgr from './authorizations-manager.js'
import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import Logger from '../logger.js'

const keys = keysFile[network.key]

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */

const adminPaymentCodes = keys.auth.strategies?.auth47?.paymentCodes?.filter(Boolean) ?? [] // filter out falsy values
const auth47Enabled = adminPaymentCodes.length > 0
const AUTH47_CALLBACK_URI = '/auth/auth47/authenticate'
const TEN_MINUTES = 10 * 60 * 1000

const verifier = auth47Enabled && keys.auth.strategies?.auth47?.hostname
    ? new Auth47Verifier(ecc, `${keys.auth.strategies?.auth47?.hostname}${network.key === 'testnet' ? '/test/v2' : '/v2'}${AUTH47_CALLBACK_URI}`)
    : null

const authCache = new QuickLRU({
    maxSize: 10,
    maxAge: TEN_MINUTES
})

const IpcTopics = {
    SET_AUTH47: 'set-auth47',
    DELETE_AUTH47: 'delete-auth47'
}

/**
 * Auth API endpoints
 */
class AuthRestApi {

    /**
     * Constructor
     * @param {HttpServer} httpServer - HTTP server
     */
    constructor(httpServer) {
        this.httpServer = httpServer

        // Establish routes
        const urlencodedParser = urlencoded()
        const jsonParser = json()

        this.httpServer.app.post(
            '/auth/login',
            urlencodedParser,
            authentMgr.authenticate,
            authorzMgr.generateAuthorizations.bind(authorzMgr),
            this.login
        )

        this.httpServer.app.post(
            '/auth/logout',
            urlencodedParser,
            authorzMgr.revokeAuthorizations.bind(authorzMgr),
            this.logout
        )

        this.httpServer.app.post(
            '/auth/refresh',
            urlencodedParser,
            authorzMgr.refreshAuthorizations.bind(authorzMgr),
            this.refresh
        )

        this.httpServer.app.get(
            '/auth/auth47/uri',
            this.getAuth47Uri.bind(this)
        )

        this.httpServer.app.post(
            AUTH47_CALLBACK_URI,
            jsonParser,
            this.authenticateAuth47.bind(this)
        )

        this.httpServer.app.get(
            '/auth/auth47/status/:nonce',
            this.checkAuth47Status.bind(this)
        )

        this.initIpc()
    }

    /**
     * Async function to initialize inter-process communication for cases where accounts process is running in cluster mode
     * @returns {Promise<void>}
     */
    async initIpc() {
        try {
            const NpmRoot = execSync('npm root -g').toString('utf8')
            const pm2Module = await import(path.join(NpmRoot, 'pm2', 'index.js'))
            const pm2 = pm2Module.default

            pm2.launchBus((error, pm2_bus) => {
                if (error) {
                    Logger.error(error, 'Importer : PM2 launchbus failed')
                    return
                }

                pm2_bus.on('process:msg', (packet) => {
                    const data = packet.data
                    if (data && data.topic === IpcTopics.SET_AUTH47) {
                        this.setFromIpc(data.value)
                    }

                    if (data && data.topic === IpcTopics.DELETE_AUTH47) {
                        authCache.delete(data.value)
                    }
                })
            })
        } catch(error) { // allowed to fail
            Logger.error(error, 'Importer : IPC initialization failed')
        }
    }

    /**
     * Set state
     * @param {[string, boolean]} nonceData
     */
    setFromIpc(nonceData) {
        const [nonce, value] = nonceData

        authCache.set(nonce, value)
    }

    /**
     * Message to set state
     * @param {[string, boolean]} nonceData
     */
    ipcSet(nonceData) {
        process.send({
            type: 'process:msg',
            data: {
                topic: IpcTopics.SET_AUTH47,
                value: nonceData
            }
        })
    }

    /**
     * Message to delete from state
     * @param {string} nonce
     */
    ipcDelete(nonce) {
        process.send({
            type: 'process:msg',
            data: {
                topic: IpcTopics.DELETE_AUTH47,
                value: nonce
            }
        })
    }

    /**
     * Get Auth47 URI
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     */
    getAuth47Uri(req, res) {
        if (auth47Enabled && verifier) {
            const nonce = crypto.randomBytes(12).toString('hex')
            const expires = new Date(Date.now() + TEN_MINUTES)
            const uri = verifier.generateURI({ nonce: nonce, expires: expires })

            authCache.set(nonce, false)
            this.ipcSet([nonce, false])

            HttpServer.sendOkData(res, { nonce: nonce, uri: uri })
        } else {
            HttpServer.sendError(res, 'Auth47 not enabled')
        }
    }

    /**
     * Authenticate Auth47 request
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     */
    authenticateAuth47(req, res) {
        if (auth47Enabled && verifier) {
            if (req.body.nym && adminPaymentCodes.includes(req.body.nym)) {
                const verifyResult = verifier.verifyProof(req.body, network.key)

                if (verifyResult.result === 'ok') {
                    const receivedNonce = (new URL(verifyResult.data.challenge)).hostname

                    if (authCache.has(receivedNonce)) {
                        authCache.set(receivedNonce, true)
                        this.ipcSet([receivedNonce, true])
                        HttpServer.sendOk(res)
                    } else {
                        HttpServer.sendAuthError(res, 'invalid nonce')
                    }
                } else {
                    HttpServer.sendAuthError(res, verifyResult.error)
                }
            } else {
                HttpServer.sendAuthError(res, 'invalid payment code')
            }
        } else {
            HttpServer.sendError(res, 'Auth47 not enabled')
        }
    }

    /**
     * Check status of current Auth47 authentication request
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     */
    checkAuth47Status(req, res) {
        if (auth47Enabled) {
            const receivedNonce = req.params.nonce

            if (authCache.has(receivedNonce)) {
                const authenticated = authCache.get(receivedNonce)

                if (authenticated) {
                    Logger.info('Auth : Successful authentication with a payment code')

                    // Generates an access token
                    const accessToken = authorzMgr._generateAccessToken({ profile: authorzMgr.TOKEN_PROFILE_ADMIN })

                    // Generates a refresh token
                    const refreshToken = authorzMgr._generateRefreshToken({ profile: authorzMgr.TOKEN_PROFILE_ADMIN })

                    // Stores the tokens in the request
                    const authorizations = {
                        access_token: accessToken,
                        refresh_token: refreshToken
                    }

                    const result = { authorizations: authorizations }

                    HttpServer.sendRawData(res, JSON.stringify(result))
                    authCache.delete(receivedNonce)
                    this.ipcDelete(receivedNonce)
                } else {
                    HttpServer.sendRawData(res, {})
                }
            } else {
                HttpServer.sendAuthError(res, 'auth request expired')
            }
        } else {
            HttpServer.sendError(res, 'Auth47 not enabled')
        }
    }

    /**
     * Login
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     */
    login(req, res) {
        try {
            const result = { authorizations: req.authorizations }
            const returnValue = JSON.stringify(result, null, 2)
            HttpServer.sendRawData(res, returnValue)
        } catch (error) {
            HttpServer.sendError(res, error)
        }
    }

    /**
     * Refresh
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     */
    refresh(req, res) {
        try {
            const result = { authorizations: req.authorizations }
            const returnValue = JSON.stringify(result, null, 2)
            HttpServer.sendRawData(res, returnValue)
        } catch (error) {
            HttpServer.sendError(res, error)
        }
    }

    /**
     * Logout
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     */
    logout(req, res) {
        HttpServer.sendOk(res)
    }

}

export default AuthRestApi

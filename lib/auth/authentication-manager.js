/*!
 * lib/auth/authentication-manager.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */


import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'
import Logger from '../logger.js'
import authorzMgr from './authorizations-manager.js'
import errors from '../errors.js'
import db from '../db/mysql-db-wrapper.js'

const keys = keysFile[network.key]

/**
 * A singleton managing the authentication to the API
 */
class AuthenticationManager {

    /**
     * Authenticate a user
     * @param {Request} req - http request object
     * @param {Response} res - http response object
     * @param {NextFunction} next - callback
     */
    async authenticate(req, res, next) {
        const apiKey = req.body.apikey || req.query.apikey

        const _adminKey = keys.auth.strategies.localApiKey.adminKey
        const _apiKeys = keys.auth.strategies.localApiKey.apiKeys
        const activeDbApiKeys = await db.getActiveApiKeys().then((keys) => keys.map((key) => key.apikey))

        if (req.user == null) {
            req.user = {}
        }

        if (apiKey === _adminKey) {
            // Check if received key is a valid api key
            Logger.info('Auth : Successful authentication with an admin key')
            req.user.authenticated = true
            req.user.profile = authorzMgr.TOKEN_PROFILE_ADMIN

            next()
        } else if (_apiKeys.includes(apiKey) || activeDbApiKeys.includes(apiKey)) {
            // Check if received key is a valid api key
            Logger.info('Auth : Successful authentication with an api key')
            req.user.authenticated = true
            req.user.profile = authorzMgr.TOKEN_PROFILE_API

            next()
        } else {
            Logger.error(null, `Auth : Authentication failure (apikey=${apiKey})`)
            next(errors.auth.INVALID_API_KEY)
        }
    }
}


export default new AuthenticationManager()

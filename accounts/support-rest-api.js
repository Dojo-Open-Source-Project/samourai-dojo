/*!
 * accounts/support-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


import validator from 'validator'

import errors from '../lib/errors.js'
import Logger from '../lib/logger.js'
import authMgr from '../lib/auth/authorizations-manager.js'
import HttpServer from '../lib/http-server/http-server.js'
import network from '../lib/bitcoin/network.js'
import hdaService from '../lib/bitcoin/hd-accounts-service.js'
import addrService from '../lib/bitcoin/addresses-service.js'
import HdAccountInfo from '../lib/wallet/hd-account-info.js'
import AddressInfo from '../lib/wallet/address-info.js'
import apiHelper from './api-helper.js'
import keysFile from '../keys/index.js'

const keys = keysFile[network.key]
const debugApi = process.argv.includes('api-debug')


/**
 * Support API endpoints
 */
class SupportRestApi {

    /**
     * Constructor
     * @param {HttpServer} httpServer - HTTP server
     */
    constructor(httpServer) {
        this.httpServer = httpServer

        this.httpServer.app.get(
            `/${keys.prefixes.support}/address/:addr/info`,
            authMgr.checkHasAdminProfile.bind(authMgr),
            this.validateAddress.bind(this),
            this.getAddressInfo.bind(this),
        )

        this.httpServer.app.get(
            `/${keys.prefixes.support}/address/:addr/rescan`,
            authMgr.checkHasAdminProfile.bind(authMgr),
            this.validateAddress.bind(this),
            this.getAddressRescan.bind(this),
        )

        this.httpServer.app.get(
            `/${keys.prefixes.support}/xpub/:xpub/info`,
            authMgr.checkHasAdminProfile.bind(authMgr),
            this.validateArgsGetXpubInfo.bind(this),
            this.getXpubInfo.bind(this),
        )

        this.httpServer.app.get(
            `/${keys.prefixes.support}/xpub/:xpub/rescan`,
            authMgr.checkHasAdminProfile.bind(authMgr),
            this.validateArgsGetXpubRescan.bind(this),
            this.getXpubRescan.bind(this),
        )

        this.httpServer.app.get(
            `/${keys.prefixes.support}/xpub/:xpub/delete`,
            authMgr.checkHasAdminProfile.bind(authMgr),
            this.validateArgsGetXpubDelete.bind(this),
            this.getXpubDelete.bind(this),
        )

        /**
         * @deprecated
         */
        this.httpServer.app.get(
            `/${keys.prefixes.support}/pairing/explorer`,
            authMgr.checkHasAdminProfile.bind(authMgr),
            this.getPairingExplorer.bind(this),
        )

        this.httpServer.app.get(
            `/${keys.prefixes.support}/pairing`,
            authMgr.checkHasAdminProfile.bind(authMgr),
            this.getPairing.bind(this),
        )

        this.httpServer.app.get(
            `/${keys.prefixes.support}/services`,
            authMgr.checkAuthentication.bind(authMgr),
            this.getServices.bind(this),
        )
    }

    /**
     * Retrieve information for a given address
     * @param {object} req - http request object
     * @param {object} res - http response object
     */
    async getAddressInfo(req, res) {
        try {
            // Parse the entities passed as url params
            const entities = apiHelper.parseEntities(req.params.addr).addrs
            if (entities.length === 0)
                return HttpServer.sendError(res, errors.address.INVALID)

            const address = entities[0]
            const info = new AddressInfo(address)
            await info.loadInfoExtended()
            await info.loadTransactions()
            await info.loadUtxos()
            const returnValue = this._formatAddressInfoResult(info)
            HttpServer.sendRawData(res, returnValue)

        } catch {
            HttpServer.sendError(res, errors.generic.GEN)

        } finally {
            debugApi && Logger.info(`API : Completed GET /support/address/${req.params.addr}/info`)
        }
    }

    /**
     * Format response to be returned
     * for calls to getAddressInfo
     * @param {AddressInfo} info
     * @returns {string} return the json to be sent as a response
     */
    _formatAddressInfoResult(info) {
        const res = info.toPojoExtended()
        return JSON.stringify(res, null, 2)
    }

    /**
     * Rescan the blockchain for a given address
     * @param {object} req - http request object
     * @param {object} res - http response object
     */
    async getAddressRescan(req, res) {
        try {
            // Parse the entities passed as url params
            const entities = apiHelper.parseEntities(req.params.addr).addrs
            if (entities.length === 0)
                return HttpServer.sendError(res, errors.address.INVALID)

            const address = entities[0]

            const returnValue = {
                status: 'Rescan complete',
            }

            await addrService.rescan(address)
            HttpServer.sendRawData(res, JSON.stringify(returnValue, null, 2))

        } catch {
            HttpServer.sendError(res, errors.generic.GEN)

        } finally {
            debugApi && Logger.info(`API : Completed GET /support/address/${req.params.addr}/rescan`)
        }
    }

    /**
     * Retrieve information for a given hd account
     * @param {object} req - http request object
     * @param {object} res - http response object
     */
    async getXpubInfo(req, res) {
        try {
            // Parse the entities passed as url params
            const entities = apiHelper.parseEntities(req.params.xpub).xpubs
            if (entities.length === 0)
                return HttpServer.sendError(res, errors.xpub.INVALID)

            const xpub = entities[0]
            let info

            try {
                info = new HdAccountInfo(xpub)
                await info.loadInfo()
                const returnValue = this._formatXpubInfoResult(info)
                HttpServer.sendRawData(res, returnValue)
            } catch (error) {
                if (error === errors.db.ERROR_NO_HD_ACCOUNT) {
                    const returnValue = this._formatXpubInfoResult(info)
                    HttpServer.sendRawData(res, returnValue)
                } else {
                    HttpServer.sendError(res, errors.generic.GEN)
                }
            }

        } catch {
            HttpServer.sendError(res, errors.generic.GEN)

        } finally {
            debugApi && Logger.info(`API : Completed GET /support/xpub/${req.params.xpub}/info`)
        }
    }

    /**
     * Format response to be returned
     * for calls to getXpubInfo
     * @param {HdAccountInfo} info
     * @returns {string} return the json to be sent as a response
     */
    _formatXpubInfoResult(info) {
        const res = info.toPojoExtended()
        return JSON.stringify(res, null, 2)
    }

    /**
     * Rescan the blockchain for a given address
     * @param {object} req - http request object
     * @param {object} res - http response object
     */
    async getXpubRescan(req, res) {
        try {
            // Parse the entities passed as url params
            const entities = apiHelper.parseEntities(req.params.xpub).xpubs
            if (entities.length === 0)
                return HttpServer.sendError(res, errors.xpub.INVALID)

            const xpub = entities[0]

            const returnValue = {
                status: 'Rescan complete',
            }

            const gapLimit = req.query.gap == null ? 0 : Number.parseInt(req.query.gap, 10)
            const startIndex = req.query.startidx == null ? 0 : Number.parseInt(req.query.startidx, 10)

            try {
                await hdaService.rescan(xpub, gapLimit, startIndex)
                HttpServer.sendRawData(res, JSON.stringify(returnValue, null, 2))
            } catch (error) {
                if (error === errors.db.ERROR_NO_HD_ACCOUNT) {
                    returnValue.status = 'Error: Not tracking xpub'
                    HttpServer.sendRawData(res, JSON.stringify(returnValue, null, 2))
                } else if (error === errors.xpub.OVERLAP) {
                    returnValue.status = 'Error: Rescan in progress'
                    HttpServer.sendRawData(res, JSON.stringify(returnValue, null, 2))
                } else {
                    returnValue.status = 'Rescan Error'
                    Logger.error(error, 'API : SupportRestApi.getXpubRescan() : Support rescan error')
                    HttpServer.sendError(res, JSON.stringify(returnValue, null, 2))
                }
            }

        } catch {
            HttpServer.sendError(res, errors.generic.GEN)

        } finally {
            debugApi && Logger.info(`API : Completed GET /support/xpub/${req.params.xpub}/rescan`)
        }
    }

    /**
     * Delete all data related to a hd account
     * @param {object} req - http request object
     * @param {object} res - http response object
     */
    async getXpubDelete(req, res) {
        try {
            // Parse the entities passed as url params
            const entities = apiHelper.parseEntities(req.params.xpub).xpubs
            if (entities.length === 0)
                return HttpServer.sendError(res, errors.xpub.INVALID)

            const xpub = entities[0]

            try {
                await hdaService.deleteHdAccount(xpub)
                HttpServer.sendOk(res)
            } catch (error) {
                HttpServer.sendError(res, error)
            }

        } catch {
            HttpServer.sendError(res, errors.generic.GEN)

        } finally {
            debugApi && Logger.info(`API : Completed GET /support/xpub/${req.params.xpub}/delete`)
        }
    }


    /**
     * Get pairing info
     */
    async getPairing(req, res) {
        try {
            const returnValue = {
                pairing: {
                    type: 'dojo.api',
                    version: keys.dojoVersion,
                    apikey: keys.auth.strategies.localApiKey.apiKeys[0]
                },
                explorer: {
                    type: `explorer.${keys.explorer.active}`,
                    url: keys.explorer.uri
                }
            }
            HttpServer.sendRawData(res, JSON.stringify(returnValue, null, 2))
        } catch (error) {
            const returnValue = {
                status: 'error'
            }
            Logger.error(error, 'API : SupportRestApi.getPairing() : Support pairing error')
            HttpServer.sendError(res, JSON.stringify(returnValue, null, 2))
        } finally {
            debugApi && Logger.info('API : Completed GET /pairing')
        }
    }

    /**
     * Get pairing info for the local block explorer
     * @deprecated
     */
    async getPairingExplorer(req, res) {
        try {
            const returnValue = {
                pairing: {
                    type: `explorer.${keys.explorer.active}`,
                    url: keys.explorer.uri
                }
            }
            HttpServer.sendRawData(res, JSON.stringify(returnValue, null, 2))
        } catch (error) {
            const returnValue = {
                status: 'error'
            }
            Logger.error(error, 'API : SupportRestApi.getPairingExplorer() : Support pairing error')
            HttpServer.sendError(res, JSON.stringify(returnValue, null, 2))
        } finally {
            debugApi && Logger.info('API : Completed GET /pairing/explorer')
        }
    }

    /**
     * Get pairing info for miscellaneous services provided by the dojo
     */
    getServices(req, res) {
        try {
            const returnValue = { services: [] }
            if (keys.explorer.active !== null) {
                returnValue.services.push({
                    type: `explorer`,
                    kind: keys.explorer.active,
                    url: keys.explorer.uri
                })
            }
            if (keys.indexer.active == 'local_indexer' && keys.indexer.localIndexer.externalUri !== null) {
                returnValue.services.push({
                    type: `indexer`,
                    kind: `fullcrum`,
                    url: keys.indexer.localIndexer.externalUri
                })
            }
            if (keys.soroban.externalRpc !== null) {
                returnValue.services.push({
                    type: `soroban`,
                    kind: `rpc`,
                    url: keys.soroban.externalRpc,
                    keyAnnounce: keys.soroban.keyAnnounce,
                    keyAuth47: keys.soroban.keyAuth47
                })
            }
            HttpServer.sendRawData(res, JSON.stringify(returnValue, null, 2))
        } catch (error) {
            const returnValue = {
                status: 'error'
            }
            Logger.error(error, 'API : SupportRestApi.getServices() : Error')
            HttpServer.sendError(res, JSON.stringify(returnValue, null, 2))
        } finally {
            debugApi && Logger.info('API : Completed GET /services')
        }
    }


    /**
     * Validate arguments related to GET xpub info requests
     * @param {object} req - http request object
     * @param {object} res - http response object
     * @param {function} next - next tiny-http middleware
     */
    validateArgsGetXpubInfo(req, res, next) {
        const isValidXpub = validator.isAlphanumeric(req.params.xpub)

        if (isValidXpub) {
            next()
        } else {
            HttpServer.sendError(res, errors.body.INVDATA)
            Logger.error(null, `API : SupportRestApi.validateArgsGetXpubInfo() : Invalid xpub ${req.params.xpub}`)
        }
    }

    /**
     * Validate arguments related to GET xpub rescan requests
     * @param {object} req - http request object
     * @param {object} res - http response object
     * @param {function} next - next tiny-http middleware
     */
    validateArgsGetXpubRescan(req, res, next) {
        const isValidXpub = validator.isAlphanumeric(req.params.xpub)
        const isValidGap = !req.query.gap || validator.isInt(req.query.gap)

        if (isValidXpub && isValidGap) {
            next()
        } else {
            HttpServer.sendError(res, errors.body.INVDATA)
            Logger.error(null, 'API : SupportRestApi.validateArgsGetXpubRescan() : Invalid arguments')
        }
    }

    /**
     * Validate arguments related to GET xpub delete requests
     * @param {object} req - http request object
     * @param {object} res - http response object
     * @param {function} next - next tiny-http middleware
     */
    validateArgsGetXpubDelete(req, res, next) {
        const isValidXpub = validator.isAlphanumeric(req.params.xpub)

        if (isValidXpub) {
            next()
        } else {
            HttpServer.sendError(res, errors.body.INVDATA)
            Logger.error(null, `API : SupportRestApi.validateArgsGetXpubDelete() : Invalid xpub ${req.params.xpub}`)
        }
    }

    /**
     * Validate arguments related to addresses requests
     * @param {object} req - http request object
     * @param {object} res - http response object
     * @param {function} next - next tiny-http middleware
     */
    validateAddress(req, res, next) {
        const isValidAddress = validator.isAlphanumeric(req.params.addr)

        if (isValidAddress) {
            next()
        } else {
            HttpServer.sendError(res, errors.body.INVDATA)
            Logger.error(null, `API : SupportRestApi.validateAddress() : Invalid address ${req.params.addr}`)
        }
    }
}

export default SupportRestApi

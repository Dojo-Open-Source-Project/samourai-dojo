/*!
 * lib/db.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

/*  eslint-disable prefer-template */

import mysql from 'mysql2'
import Logger from '../logger.js'
import util from '../util.js'
import errors from '../errors.js'
import hdaHelper from '../bitcoin/hd-accounts-helper.js'
import network from '../bitcoin/network.js'
import keysFile from '../../keys/index.js'

const keys = keysFile[network.key]
const debug = process.argv.includes('db-debug')
const queryDebug = process.argv.includes('dbquery-debug')

/**
 * @typedef {import('mysql2').Pool} MySqlPool
 * @typedef {import('mysql2').PoolOptions} MySqlPoolOptions
 * @typedef {import('mysql2').FieldPacket} MySqlFieldPacket
 */

/**
 * Subqueries used by getAddrAndXpubsNbTransactions()
 */
const SUBQUERY_TXIDS_ADDR = '( \
  SELECT `transactions`.`txnTxid` AS txnTxid \
  FROM `outputs` \
  INNER JOIN `transactions` ON `transactions`.`txnID` = `outputs`.`txnID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  WHERE `addresses`.`addrAddress` IN (?) \
) UNION ( \
  SELECT `transactions`.`txnTxid` AS txnTxid \
  FROM `inputs` \
  INNER JOIN `transactions` ON `transactions`.`txnID` = `inputs`.`txnID` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  WHERE `addresses`.`addrAddress` IN (?) \
)'

const SUBQUERY_TXIDS_XPUBS = '( \
  SELECT `transactions`.`txnTxid` AS txnTxid \
  FROM `outputs` \
  INNER JOIN `transactions` ON `transactions`.`txnID` = `outputs`.`txnID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  WHERE `hd`.`hdXpub` IN (?) \
) UNION ( \
  SELECT `transactions`.`txnTxid` AS txnTxid \
  FROM `inputs` \
  INNER JOIN `transactions` ON `transactions`.`txnID` = `inputs`.`txnID` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  WHERE `hd`.`hdXpub` IN (?) \
)'

/**
 * Subqueries used by getTxsByAddrAndXpubs()
 */
const SUBQUERY_TXS_ADDR = '(\
  SELECT \
    `transactions`.`txnID` AS `txnID`, \
    `transactions`.`txnTxid` AS `txnTxid`, \
    `transactions`.`txnVersion` AS `txnVersion`, \
    `transactions`.`txnLocktime` AS `txnLocktime`, \
    `blocks`.`blockHeight` AS `blockHeight`, \
    LEAST(`transactions`.`txnCreated`, IFNULL(`blocks`.`blockTime`, 32503680000)) AS `time` \
  FROM `transactions` \
  INNER JOIN `outputs` ON `outputs`.`txnID` = `transactions`.`txnID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  LEFT JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
  WHERE `addresses`.`addrAddress` IN (?) \
) UNION DISTINCT (\
  SELECT \
    `transactions`.`txnID` AS `txnID`, \
    `transactions`.`txnTxid` AS `txnTxid`, \
    `transactions`.`txnVersion` AS `txnVersion`, \
    `transactions`.`txnLocktime` AS `txnLocktime`, \
    `blocks`.`blockHeight` AS `blockHeight`, \
    LEAST(`transactions`.`txnCreated`, IFNULL(`blocks`.`blockTime`, 32503680000)) AS `time` \
  FROM `transactions` \
  INNER JOIN `inputs` ON `inputs`.`txnID` = `transactions`.`txnID` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  LEFT JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
  WHERE `addresses`.`addrAddress` IN (?) \
)'

const SUBQUERY_TXS_XPUB = '(\
  SELECT \
    `transactions`.`txnID` AS `txnID`, \
    `transactions`.`txnTxid` AS `txnTxid`, \
    `transactions`.`txnVersion` AS `txnVersion`, \
    `transactions`.`txnLocktime` AS `txnLocktime`, \
    `blocks`.`blockHeight` AS `blockHeight`, \
    LEAST(`transactions`.`txnCreated`, IFNULL(`blocks`.`blockTime`, 32503680000)) AS `time` \
  FROM `transactions` \
  INNER JOIN `outputs` ON `outputs`.`txnID` = `transactions`.`txnID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  LEFT JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
  WHERE `hd`.`hdXpub` IN (?) \
) UNION DISTINCT (\
  SELECT \
    `transactions`.`txnID` AS `txnID`, \
    `transactions`.`txnTxid` AS `txnTxid`, \
    `transactions`.`txnVersion` AS `txnVersion`, \
    `transactions`.`txnLocktime` AS `txnLocktime`, \
    `blocks`.`blockHeight` AS `blockHeight`, \
    LEAST(`transactions`.`txnCreated`, IFNULL(`blocks`.`blockTime`, 32503680000)) AS `time` \
  FROM `transactions` \
  INNER JOIN `inputs` ON `inputs`.`txnID` = `transactions`.`txnID` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  LEFT JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
  WHERE `hd`.`hdXpub` IN (?) \
)'

const SUBQUERY_UTXOS_ADDR = '(\
  SELECT \
    `transactions`.`txnID` AS `txnID`, \
    null AS `outIndex`, \
    null AS `outAmount`, \
    null AS `outAddress`, \
    `inputs`.`inIndex` AS `inIndex`, \
    `inputs`.`inSequence` AS `inSequence`, \
    `prevTx`.`txnTxid` AS `inOutTxid`, \
    `outputs`.`outIndex` AS `inOutIndex`, \
    `outputs`.`outAmount` AS `inOutAmount`, \
    `addresses`.`addrAddress` AS `inOutAddress`, \
    null AS `hdAddrChain`, \
    null AS `hdAddrIndex`, \
    null AS `hdXpub` \
  FROM `transactions` \
  INNER JOIN `inputs` ON `inputs`.`txnID` = `transactions`.`txnID` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `transactions` AS `prevTx` ON `prevTx`.`txnID` = `outputs`.`txnID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  WHERE \
    `transactions`.`txnID` IN (?) AND \
    `addresses`.`addrAddress` IN (?) \
) UNION ( \
  SELECT \
    `transactions`.`txnID` AS `txnID`, \
    `outputs`.`outIndex` AS `outIndex`, \
    `outputs`.`outAmount` AS `outAmount`, \
    `addresses`.`addrAddress` AS `outAddress`, \
    null AS `inIndex`, \
    null AS `inSequence`, \
    null AS `inOutTxid`, \
    null AS `inOutIndex`, \
    null AS `inOutAmount`, \
    null AS `inOutAddress`, \
    null AS `hdAddrChain`, \
    null AS `hdAddrIndex`, \
    null AS `hdXpub` \
  FROM `transactions` \
  INNER JOIN `outputs` ON `outputs`.`txnID` = `transactions`.`txnID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  WHERE \
    `transactions`.`txnID` IN (?) AND \
    `addresses`.`addrAddress` IN (?) \
)'

const SUBQUERY_UTXOS_XPUB = '(\
  SELECT \
    `transactions`.`txnID` AS `txnID`, \
    null AS `outIndex`, \
    null AS `outAmount`, \
    null AS `outAddress`, \
    `inputs`.`inIndex` AS `inIndex`, \
    `inputs`.`inSequence` AS `inSequence`, \
    `prevTx`.`txnTxid` AS `inOutTxid`, \
    `outputs`.`outIndex` AS `inOutIndex`, \
    `outputs`.`outAmount` AS `inOutAmount`, \
    `addresses`.`addrAddress` AS `inOutAddress`, \
    `hd_addresses`.`hdAddrChain` AS `hdAddrChain`, \
    `hd_addresses`.`hdAddrIndex` AS `hdAddrIndex`, \
    `hd`.`hdXpub` AS `hdXpub` \
  FROM `transactions` \
  INNER JOIN `inputs` ON `inputs`.`txnID` = `transactions`.`txnID` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `transactions` AS `prevTx` ON `prevTx`.`txnID` = `outputs`.`txnID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  WHERE \
    `transactions`.`txnID` IN (?) AND \
    `hd`.`hdXpub` IN (?) \
) UNION ( \
  SELECT \
    `transactions`.`txnID` AS `txnID`, \
    `outputs`.`outIndex` AS `outIndex`, \
    `outputs`.`outAmount` AS `outAmount`, \
    `addresses`.`addrAddress` AS `outAddress`, \
    null AS `inIndex`, \
    null AS `inSequence`, \
    null AS `inOutTxid`, \
    null AS `inOutIndex`, \
    null AS `inOutAmount`, \
    null AS `inOutAddress`, \
    `hd_addresses`.`hdAddrChain` AS `hdAddrChain`, \
    `hd_addresses`.`hdAddrIndex` AS `hdAddrIndex`, \
    `hd`.`hdXpub` AS `hdXpub` \
  FROM `transactions` \
  INNER JOIN `outputs` ON `outputs`.`txnID` = `transactions`.`txnID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  WHERE \
    `transactions`.`txnID` IN (?) AND \
    `hd`.`hdXpub` IN (?) \
)'

const SUBQUERY_GET_TX_OUTS = 'SELECT \
    `transactions`.`txnID`, \
    `transactions`.`txnTxid`, \
    `transactions`.`txnCreated`, \
    `transactions`.`txnVersion`, \
    `transactions`.`txnLocktime`, \
    `blocks`.`blockHeight`, \
    `blocks`.`blockTime`, \
    `outputs`.`outID`, \
    `outputs`.`outIndex`, \
    `outputs`.`outAmount`, \
    `outputs`.`outScript`, \
    `addresses`.`addrAddress`, \
    `hd_addresses`.`hdAddrChain`, \
    `hd_addresses`.`hdAddrIndex`, \
    `hd`.`hdXpub` \
  FROM `transactions` \
  INNER JOIN `outputs` ON `transactions`.`txnID` = `outputs`.`txnID` \
  INNER JOIN `addresses` ON `outputs`.`addrID` = `addresses`.`addrID` \
  LEFT JOIN `hd_addresses` ON `outputs`.`addrID` = `hd_addresses`.`addrID` \
  LEFT JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
  LEFT JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
  WHERE `transactions`.`txnTxid` = ? \
  ORDER BY `outputs`.`outIndex` ASC'

const SUBQUERY_GET_TX_INS = 'SELECT \
    `t_in`.`txnTxid`, \
    `t_in`.`txnCreated`, \
    `t_in`.`txnVersion`, \
    `t_in`.`txnLocktime`, \
    `blocks`.`blockHeight`, \
    `blocks`.`blockTime`, \
    `t_out`.`txnTxid` AS `prevOutTxid`, \
    `inputs`.`inIndex`, \
    `inputs`.`inSequence`, \
    `inputs`.`outID`, \
    `outputs`.`outIndex`, \
    `outputs`.`outAmount`, \
    `outputs`.`outScript`, \
    `addresses`.`addrAddress`, \
    `hd_addresses`.`hdAddrChain`, \
    `hd_addresses`.`hdAddrIndex`, \
    `hd`.`hdXpub` \
  FROM `inputs` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `transactions` AS `t_in` ON `t_in`.`txnID` = `inputs`.`txnID` \
  INNER JOIN `transactions` AS `t_out` ON `t_out`.`txnID` = `outputs`.`txnID` \
  INNER JOIN `addresses` ON `outputs`.`addrID` = `addresses`.`addrID` \
  LEFT JOIN `hd_addresses` ON `outputs`.`addrID` = `hd_addresses`.`addrID` \
  LEFT JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
  LEFT JOIN `blocks` ON `t_in`.`blockID` = `blocks`.`blockID` \
  WHERE `t_in`.`txnTxid` = ? \
  ORDER BY `inputs`.`inIndex` ASC'

/**
 * @type {MySqlPoolOptions}
 */
const defaultConfig = {
    decimalNumbers: true,
    namedPlaceholders: true
}

/**
 * A singleton providing a MySQL db wrapper
 * Node-mysql doc: https://github.com/felixge/node-mysql
 */
class MySqlDbWrapper {

    /**
     * Constructor
     */
    constructor() {
        /**
         * @type {MySqlPoolOptions | null}
         */
        this.dbConfig = null
        // Db connections pool
        /**
         * @type {MySqlPool | null}
         */
        this.pool = null
        // Lock preventing multiple reconnects
        this.lockReconnect = false
        // Timer managing reconnects
        this.timerReconnect = null
    }

    /**
     * Connect the wrapper to the database
     * @param {MySqlPoolOptions} dbConfig - database configuration
     */
    connect(dbConfig) {
        if (dbConfig.host?.includes('.sock')) {
            dbConfig.socketPath = dbConfig.host
        }

        this.dbConfig = { ...defaultConfig, ...dbConfig }

        try {
            if (this.pool)
                this.handleReconnect()
            else
                this.handleConnect()
        } catch {
            this.handleReconnect()
        }
    }

    /**
     * Disconnect wrapper from the database
     * @returns {Promise<void>}
     */
    disconnect() {
        return new Promise((resolve) => {
            if (this.pool) {
                this.pool.end((err) => {
                    if (err) {
                        Logger.error(err, 'DB Wrapper : Error when disconnecting from DB')
                    }

                    this.pool = null
                    resolve()
                })
            }

            resolve()
        })
    }

    /**
     * Connect the wrapper to the mysql server
     */
    handleConnect() {
        try {
            this.pool = mysql.createPool(this.dbConfig)
            Logger.info(`Db Wrapper : Created a database pool of ${this.dbConfig.connectionLimit} connections`)

            if (debug) {
                this.pool.on('acquire', (conn) => {
                    Logger.info(`Db Wrapper : Connection ${conn.threadId} acquired`)
                })
                this.pool.on('enqueue', () => {
                    Logger.info('Db Wrapper : Waiting for a new connection slot')
                })
                this.pool.on('release', (conn) => {
                    Logger.info(`Db Wrapper : Connection ${conn.threadId} released`)
                })
            }
        } catch (error) {
            Logger.error(error, 'Db Wrapper : handleConnect() : Problem met while trying to initialize a new pool')
            throw error
        }
    }

    /**
     * Reconnect the wrapper to the mysql server
     */
    handleReconnect() {
        if (this.pool) {
            // Manage the lock
            if (this.lockReconnect)
                return

            this.lockReconnect = true

            if (this.timerReconnect)
                clearTimeout(this.timerReconnect)

            // Destroy previous pool
            this.pool.end(error => {
                if (error) {
                    Logger.error(error, 'Db Wrapper : handleReconnect() : Problem met while terminating the pool')
                    this.timerReconnect = setTimeout(() => this.handleReconnect(), 2000)
                } else {
                    this.handleConnect()
                }
                this.lockReconnect = false
            })
        }
    }

    /**
     * @description Send a query
     * @param {string} query - SQL query to be sent
     * @param {(any | any[] | Record<string, any>)=} values - SQL query values
     * @param {boolean=} usePrepare - use prepared statements
     * @param {number=} retries - number of retries left
     * @return {Promise<any[] | any>}
     */
    async _query(query, values, usePrepare = false, retries = 5) {
        queryDebug && Logger.info(`Db Wrapper : ${mysql.format(query, values)}`)

        const promisePool = this.pool.promise()

        try {
            const [result] = usePrepare ? await promisePool.execute(query, values) : await promisePool.query(mysql.format(query, values))

            queryDebug && Logger.info(`Db Wrapper : ${JSON.stringify(result)}`)

            return result
        } catch (error) {
            // Retry the request on lock errors
            if ((error.code === 'ER_LOCK_DEADLOCK' ||
                error.code === 'ER_LOCK_TIMEOUT' ||
                error.code === 'ER_LOCK_WAIT_TIMEOUT') && (retries > 0)
            ) {
                this.queryError(new Error('Lock detected. Retry request in a few ms'), mysql.format(query, values))
                await util.delay(Math.floor((Math.random() * 100) + 1))
                return await this._query(query, values, usePrepare, retries - 1)
            }

            this.queryError(error, mysql.format(query, values))
            throw error
        }
    }

    /**
     * @description Log a query error
     * @param {Error} error
     * @param {string} query
     */
    queryError(error, query) {
        Logger.error(error, 'Db Wrapper : query() : Query Error')
        Logger.error(null, `Db Wrapper : ${query}`)
    }

    /**
     * Get the ID of an address
     * @param {string} address - bitcoin address
     * @returns {Promise<number>} returns the address id
     */
    async getAddressId(address) {
        const sqlQuery = 'SELECT `addrID` FROM `addresses` WHERE `addrAddress` = ?'
        const result = await this._query(sqlQuery, [address], true)

        if (result.length > 0)
            return result[0].addrID

        throw errors.db.ERROR_NO_ADDRESS
    }

    /**
     * Get the ID of an Address. Ensures that the address exists.
     * @param {string} address - bitcoin address
     * @returns {Promise<number>} returns the address id
     */
    async ensureAddressId(address) {
        const sqlQuery = 'SELECT `addrID` FROM `addresses` WHERE `addrAddress` = ?'
        const result = await this._query(sqlQuery, [address], true)

        if (result.length > 0)
            return result[0].addrID

        const sqlQuery2 = 'INSERT INTO `addresses` SET ?'
        const parameters2 = { addrAddress: address }
        const result2 = await this._query(sqlQuery2, parameters2)
        return result2.insertId
    }

    /**
     * Get the IDs of an array of Addresses
     * @param {string[]} addresses - array of bitcoin addresses
     * @returns {Promise<Record<string, number>>} returns a map of addresses to IDs: {[address]: 100}
     */
    async getAddressesIds(addresses) {
        const returnValue = {}

        if (addresses.length === 0)
            return returnValue

        const sqlQuery = 'SELECT * FROM `addresses` WHERE `addrAddress` IN (?)'
        const parameters = [addresses]
        const result = await this._query(sqlQuery, parameters)

        for (let r of result)
            returnValue[r.addrAddress] = r.addrID

        return returnValue
    }

    /**
     * Bulk insert addresses.
     * @param {string[]} addresses - array of bitcoin addresses
     * @returns {Promise<unknown>}
     */
    async addAddresses(addresses) {
        if (addresses.length === 0)
            return []

        const sqlQuery = 'INSERT IGNORE INTO `addresses` (addrAddress) VALUES ?'
        const parameters = [addresses.map(a => [a])]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Bulk select address entries
     * @param {string[]} addresses - array of bitcoin addresses
     * @returns {Promise<object[]>}
     */
    async getAddresses(addresses) {
        if (addresses.length === 0)
            return []

        const sqlQuery = 'SELECT * FROM `addresses` WHERE `addrAddress` IN (?)'
        const parameters = [addresses]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Get address balance.
     * @param {string} address - bitcoin address
     * @returns {Promise<number>} returns the balance of the address
     */
    async getAddressBalance(address) {
        if (address == null)
            return null

        const sqlQuery = 'SELECT SUM(`outputs`.`outAmount`) as balance \
      FROM `addresses` \
      INNER JOIN `outputs` ON `outputs`.`addrID` = `addresses`.`addrID`  \
      LEFT JOIN `inputs` ON `outputs`.`outID` = `inputs`.`outID` \
      WHERE \
        `inputs`.`outID` IS NULL AND \
        `addresses`.`addrAddress` = ?'

        const results = await this._query(sqlQuery, [address], true)

        if (results.length === 1) {
            const balance = results[0].balance
            return (balance == null) ? 0 : balance
        }

        return null
    }

    /**
     * Get the number of transactions for an address.
     * @param {string} address - bitcoin address
     * @returns {Promise<number | null>} returns the number of transactions for the address
     */
    async getAddressNbTransactions(address) {
        if (address == null)
            return null

        const sqlQuery = 'SELECT COUNT(DISTINCT `r`.`txnTxid`) AS nbTxs \
      FROM ( \
        ( \
          SELECT `transactions`.`txnTxid` AS txnTxid \
          FROM `outputs` \
          INNER JOIN `transactions` ON `transactions`.`txnID` = `outputs`.`txnID` \
          INNER JOIN `addresses` ON `outputs`.`addrID` = `addresses`.`addrID` \
          WHERE `addresses`.`addrAddress` = ? \
        ) UNION ( \
          SELECT `transactions`.`txnTxid` AS txnTxid \
          FROM `inputs` \
          INNER JOIN `transactions` ON `transactions`.`txnID` = `inputs`.`txnID` \
          INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
          INNER JOIN `addresses` ON `outputs`.`addrID` = `addresses`.`addrID` \
          WHERE `addresses`.`addrAddress` = ? \
        ) \
      ) AS `r`'

        const parameters = [address, address]
        const results = await this._query(sqlQuery, parameters, true)

        if (results.length === 1) {
            const nbTxs = results[0].nbTxs
            return (nbTxs == null) ? 0 : nbTxs
        }

        return null
    }

    /**
     * Get an HD account.
     * @param {string} xpub - xpub
     * @returns {Promise<{hdID: number, hdXpub: string, hdCreated: number, hdType: number}>}
     *  throws if no record of xpub
     */
    async getHDAccount(xpub) {
        const sqlQuery = 'SELECT * FROM `hd` WHERE `hdXpub` = ?'
        const result = await this._query(sqlQuery, [xpub], true)

        if (result.length > 0)
            return result[0]

        throw errors.db.ERROR_NO_HD_ACCOUNT
    }

    /**
     * Get the ID of an HD account
     * @param {string} xpub - xpub
     * @returns {Promise<number>} returns the id of the hd account
     */
    async getHDAccountId(xpub) {
        const sqlQuery = 'SELECT `hdID` FROM `hd` WHERE `hdXpub` = ?'
        const result = await this._query(sqlQuery, [xpub], true)

        if (result.length > 0)
            return result[0].hdID

        throw errors.db.ERROR_NO_HD_ACCOUNT
    }

    /**
     * Get the ID of an HD account. Ensures that the account exists.
     * @param {string} xpub - xpub
     * @param {number} type - hd account type
     * @returns {Promise<number>} returns the id of the hd account
     */
    async ensureHDAccountId(xpub, type) {
        const info = hdaHelper.classify(type)

        if (info.type === null)
            throw errors.xpub.SEGWIT

        // Get the ID of the xpub
        const sqlQuery = 'SELECT `hdID` FROM `hd` WHERE `hdXpub` = ?'
        const result = await this._query(sqlQuery, [xpub], true)

        if (result.length > 0)
            return result[0].hdID

        const sqlQuery2 = 'INSERT INTO `hd` SET ?'
        const parameters2 = {
            hdXpub: xpub,
            hdCreated: util.unix(),
            hdType: type,
        }
        const result2 = await this._query(sqlQuery2, parameters2)
        return result2.insertId
    }

    /**
     * Lock the type of a hd account
     * @param {string} xpub - xpub
     * @param {boolean} locked - true for locking, false for unlocking
     * @returns {Promise<boolean>} locked - true for locking, false for unlocking
     */
    async setLockHDAccountType(xpub, locked) {
        const account = await this.getHDAccount(xpub)
        const info = hdaHelper.classify(account.hdType)

        if (info.locked === locked)
            return true

        const hdType = hdaHelper.makeType(account.hdType, locked)
        const sqlQuery = 'UPDATE `hd` SET `hdType` = ? WHERE `hdXpub` = ?'
        const parameters = [hdType, xpub]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Delete a hd account
     * @param {string} xpub - xpub
     * @returns {Promise<unknown>}
     */
    async deleteHDAccount(xpub) {
        try {
            // Check that this HD account exists
            await this.getHDAccountId(xpub)

            // Delete addresses associated with this xpub.
            // Address deletion cascades into transaction inputs & outputs.
            const sqlQuery = 'DELETE `addresses`.* FROM `addresses` \
        INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
        INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
        WHERE `hd`.`hdXpub` = ?'

            await this._query(sqlQuery, [xpub])

            // Delete HD account entry
            const sqlQuery2 = 'DELETE FROM `hd` WHERE `hdXpub` = ?'

            return await this._query(sqlQuery2, [xpub])

        } catch (error) {
            Logger(error, 'Db Wrapper : deleteHDAccount()')
        }
    }

    /**
     * Add an address a hd account
     * @param {string} address - bitcoin address
     * @param {string} xpub - xpub
     * @param {number} chain - derivation chain
     * @param {index} index - derivation index for the address
     * @returns {Promise<unknown>}
     */
    async addAddressToHDAccount(address, xpub, chain, index) {
        const results = await Promise.all([
            this.ensureAddressId(address),
            this.getHDAccountId(xpub)
        ])

        const addrID = results[0]
        const hdID = results[1]

        if (hdID == null)
            throw null

        const sqlQuery = 'INSERT INTO `hd_addresses` SET ?'
        const parameters = {
            hdID: hdID,
            addrID: addrID,
            hdAddrChain: chain,
            hdAddrIndex: index
        }

        return await this._query(sqlQuery, parameters)
    }

    /**
     * Bulk-add addresses to an HD account.
     * @param {string} xpub - xpub
     * @param {object[]} addressData - array of {address: '...', chain: <int>, index: <int>}
     *  which is the output of the HDAccountsHelper.deriveAddresses()
     *  @returns {Promise<unknown>}
     */
    async addAddressesToHDAccount(xpub, addressData) {
        if (addressData.length === 0)
            return

        const addresses = addressData.map(d => d.address)
        const hdID = await this.getHDAccountId(xpub)

        // Bulk insert addresses
        await this.addAddresses(addresses)

        // Bulk get address IDs
        const addrIdMap = await this.getAddressesIds(addresses)

        // Convert input addressData into database entry format
        const data = []
        for (let entry of addressData) {
            data.push([
                hdID,
                addrIdMap[entry.address],
                entry.chain,
                entry.index
            ])
        }

        const sqlQuery = 'INSERT IGNORE INTO `hd_addresses` \
      (hdID, addrID, hdAddrChain, hdAddrIndex) VALUES ?'
        const parameters = [data]

        return await this._query(sqlQuery, parameters)
    }

    /**
     * Get hd accounts associated to a list of addresses
     * @param {string[]} addresses - array of bitcoin addresses
     * @returns {Promise<object[]>}
     */
    async getUngroupedHDAccountsByAddresses(addresses) {
        if (addresses.length === 0) return {}

        const sqlQuery = 'SELECT \
        `hd`.`hdID`, \
        `hd`.`hdXpub`, \
        `hd`.`hdType`, \
        `addresses`.`addrID`, \
        `addresses`.`addrAddress`, \
        `hd_addresses`.`hdAddrChain`, \
        `hd_addresses`.`hdAddrIndex` \
      FROM `addresses` \
      LEFT JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      LEFT JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `addresses`.`addrAddress` IN (?) \
      AND `addresses`.`addrAddress` NOT IN (SELECT addrAddress FROM banned_addresses)'

        const parameters = [addresses]

        return await this._query(sqlQuery, parameters)
    }

    /**
     * Get any HD accounts that own the input addresses
     * If addresses are known but not associated with an HD account,
     * theyare returned in the `loose` category
     * @param {string[]} addresses - array of bitcoin addresses
     * @returns {Promise<object>}
     *  {
     *     hd: {
     *       [xpub]: {
     *         hdID: N,
     *         hdType: M,
     *         addresses:[...]
     *       },
     *       ...
     *    }
     *    loose:[...]
     *  }
     */
    async getHDAccountsByAddresses(addresses) {
        const returnValue = {
            hd: {},
            loose: []
        }

        if (addresses.length === 0)
            return returnValue

        const sqlQuery = 'SELECT \
        `hd`.`hdID`, \
        `hd`.`hdXpub`, \
        `hd`.`hdType`, \
        `addresses`.`addrID`, \
        `addresses`.`addrAddress`, \
        `hd_addresses`.`hdAddrChain`, \
        `hd_addresses`.`hdAddrIndex` \
      FROM `addresses` \
      LEFT JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      LEFT JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `addresses`.`addrAddress` IN (?) \
      AND `addresses`.`addrAddress` NOT IN (SELECT addrAddress FROM banned_addresses)'

        const parameters = [addresses]
        const results = await this._query(sqlQuery, parameters)

        for (let r of results) {
            if (r.hdXpub == null) {
                returnValue.loose.push({
                    addrID: r.addrID,
                    addrAddress: r.addrAddress,
                })
            } else {
                if (!returnValue.hd[r.hdXpub]) {
                    returnValue.hd[r.hdXpub] = {
                        hdID: r.hdID,
                        hdType: r.hdType,
                        addresses: []
                    }
                }

                returnValue.hd[r.hdXpub].addresses.push({
                    addrID: r.addrID,
                    addrAddress: r.addrAddress,
                    hdAddrChain: r.hdAddrChain,
                    hdAddrIndex: r.hdAddrIndex,
                })
            }
        }

        return returnValue
    }

    /**
     * Get an HD account balance
     * @param {string} xpub - xpub
     * @returns {Promise<number>} returns the balance of the hd account
     */
    async getHDAccountBalance(xpub) {
        const sqlQuery = 'SELECT \
        SUM(`outputs`.`outAmount`) as balance \
      FROM `hd_addresses` \
      INNER JOIN `addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      INNER JOIN `outputs` ON `outputs`.`addrID` = `addresses`.`addrID`  \
      LEFT JOIN `inputs` ON `outputs`.`outID` = `inputs`.`outID` \
      WHERE `inputs`.`outID` IS NULL \
        AND `hd`.`hdXpub` = ?'

        const results = await this._query(sqlQuery, [xpub], true)

        if (results.length === 1)
            return (results[0].balance == null) ? 0 : results[0].balance

        return null
    }

    /**
     * Get next unused address indices for each HD chain of an account
     * @param {string} xpub - xpub
     * @returns {Promise<number[]>} returns an array of unused indices
     *     [M/0/X, M/1/Y] -> [X,Y]
     */
    async getHDAccountNextUnusedIndices(xpub) {
        const sqlQuery = 'SELECT \
        `hd_addresses`.`hdAddrChain`, \
        MAX(`hd_addresses`.`hdAddrIndex`) + 1 AS `nextUnusedIndex` \
      FROM `hd_addresses` \
      INNER JOIN `addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      INNER JOIN `outputs` ON `outputs`.`addrID` = `addresses`.`addrID`  \
      WHERE `hd`.`hdXpub` = ? \
      GROUP BY `hd_addresses`.`hdAddrChain`'

        const results = await this._query(sqlQuery, [xpub], true)

        const returnValue = [0, 0]

        for (let r of results)
            if ([0, 1].includes(r.hdAddrChain))
                returnValue[r.hdAddrChain] = r.nextUnusedIndex

        return returnValue
    }

    /**
     * Get the maximum derived address index for each HD chain of an account
     * @param {string} xpub - xpub
     * @returns {Promise<number[]>} returns an array of derived indices
     *     [M/0/X, M/1/Y] -> [X,Y]
     */
    async getHDAccountDerivedIndices(xpub) {
        const sqlQuery = 'SELECT \
        `hd_addresses`.`hdAddrChain`, \
        MAX(`hd_addresses`.`hdAddrIndex`) AS `maxDerivedIndex` \
      FROM `hd_addresses` \
      INNER JOIN `addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `hd`.`hdXpub` = ? \
      GROUP BY `hd_addresses`.`hdAddrChain`'

        const results = await this._query(sqlQuery, [xpub], true)

        const returnValue = [-1, -1]

        for (let r of results)
            if ([0, 1].includes(r.hdAddrChain))
                returnValue[r.hdAddrChain] = r.maxDerivedIndex

        return returnValue
    }

    /**
     * Get the number of indices derived in an interval for a HD chain
     * @param {string} xpub - xpub
     * @param {number} chain - HD chain (0 or 1)
     * @param {number} minIdx - min index of derivation
     * @param {number} maxIdx - max index of derivation
     * @returns {Promise<number[]>} returns an array of number of derived indices
     */
    async getHDAccountNbDerivedIndices(xpub, chain, minIdx, maxIdx) {
        const sqlQuery = 'SELECT \
        COUNT(`hd_addresses`.`hdAddrIndex`) AS `nbDerivedIndices` \
      FROM `hd_addresses` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `hd`.`hdXpub` = ? \
      AND `hd_addresses`.`hdAddrChain` = ? \
      AND `hd_addresses`.`hdAddrIndex` >= ? \
      AND `hd_addresses`.`hdAddrIndex` <= ?'

        const parameters = [xpub, chain, minIdx, maxIdx]
        const results = await this._query(sqlQuery, parameters, true)

        if (results.length === 1) {
            const nbDerivedIndices = results[0].nbDerivedIndices
            return (nbDerivedIndices == null) ? 0 : nbDerivedIndices
        }

        return 0
    }

    /**
     * Get the number of transactions for an HD account
     * @param {string} xpub - xpub
     * @returns {Promise<number | null>} returns the balance of the hd account
     */
    async getHDAccountNbTransactions(xpub) {
        const sqlQuery = 'SELECT COUNT(DISTINCT `r`.`txnTxid`) AS nbTxs \
      FROM ( \
        ( \
          SELECT `transactions`.`txnTxid` AS txnTxid \
          FROM `outputs` \
          INNER JOIN `transactions` ON `transactions`.`txnID` = `outputs`.`txnID` \
          INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `outputs`.`addrID` \
          INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
          WHERE `hd`.`hdXpub` = ? \
        ) UNION ( \
          SELECT `transactions`.`txnTxid` AS txnTxid \
          FROM `inputs` \
          INNER JOIN `transactions` ON `transactions`.`txnID` = `inputs`.`txnID` \
          INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
          INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `outputs`.`addrID` \
          INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
          WHERE `hd`.`hdXpub` = ? \
        ) \
      ) AS `r`'

        const parameters = [xpub, xpub]
        const results = await this._query(sqlQuery, parameters, true)

        if (results.length === 1)
            return (results[0].nbTxs == null) ? 0 : results[0].nbTxs

        return null
    }

    /**
     * Get the number of transactions for a list of addresses and HD accounts
     * @param {string[]} addresses - array of bitcoin addresses
     * @param {string[]} xpubs - array of xpubs
     * @returns {Promise<number | null>} returns the number of transactions
     */
    async getAddrAndXpubsNbTransactions(addresses, xpubs) {
        if (
            (!addresses || addresses.length === 0)
            && (!xpubs || xpubs.length === 0)
        ) {
            return []
        }

        // Prepares subqueries for the query
        // retrieving txs of interest
        let subQuery = ''
        let subQueries = []

        if (addresses && addresses.length > 0) {
            const parameters = [addresses, addresses]
            subQuery = mysql.format(SUBQUERY_TXIDS_ADDR, parameters)
            subQueries.push(subQuery)
        }

        if (xpubs && xpubs.length > 0) {
            const parameters = [xpubs, xpubs]
            subQuery = mysql.format(SUBQUERY_TXIDS_XPUBS, parameters)
            subQueries.push(subQuery)
        }

        subQuery = subQueries.join(' UNION ')

        const sqlQuery = 'SELECT COUNT(DISTINCT `r`.`txnTxid`) AS nbTxs \
      FROM (' + subQuery + ') AS `r`'

        const results = await this._query(sqlQuery)

        if (results.length === 1)
            return (results[0].nbTxs == null) ? 0 : results[0].nbTxs

        return null
    }

    /**
     * Get the transactions for a list of addresses and HD accounts
     * @param {string[]} addresses - array of bitcoin addresses
     * @param {string[]=} xpubs - array of xpubs
     * @param {number=} page - page
     * @param {number=} nbTxsPerPage - number of transactions per page
     * @returns {Promise<object[]>} returns an array of transactions
     */
    async getTxsByAddrAndXpubs(addresses, xpubs, page, nbTxsPerPage) {
        if (
            (!addresses || addresses.length === 0)
            && (!xpubs || xpubs.length === 0)
        ) {
            return []
        }

        // Manages the paging
        if (page == null)
            page = 0

        if (nbTxsPerPage == null)
            nbTxsPerPage = keys.multiaddr.transactions

        const skip = page * nbTxsPerPage

        // Prepares subqueries for the query
        // retrieving txs of interest
        let subQuery = ''
        let subQueries = []

        if (addresses && addresses.length > 0) {
            const parameters = [addresses, addresses]
            subQuery = mysql.format(SUBQUERY_TXS_ADDR, parameters)
            subQueries.push(subQuery)
        }

        if (xpubs && xpubs.length > 0) {
            const parameters = [xpubs, xpubs]
            subQuery = mysql.format(SUBQUERY_TXS_XPUB, parameters)
            subQueries.push(subQuery)
        }

        subQuery = subQueries.join(' UNION DISTINCT ')

        // Get a page of transactions
        const sqlQuery = 'SELECT \
        `txs`.`txnID`, \
        `txs`.`txnTxid`, \
        `txs`.`txnVersion`, \
        `txs`.`txnLocktime`, \
        `txs`.`blockHeight`, \
        `txs`.`time` \
      FROM (' + subQuery + ') AS txs \
      ORDER BY `txs`.`time` DESC, `txs`.`txnID` DESC \
      LIMIT ?,?'
        const parameters = [skip, nbTxsPerPage]
        const txs = await this._query(sqlQuery, parameters)

        const txsIds = txs.map(t => t.txnID)

        if (txsIds.length === 0)
            return []

        // Prepares subqueries for
        // the query retrieving utxos of interest
        let subQuery2 = ''
        let subQueries2 = []

        if (addresses && addresses.length > 0) {
            const parameters2 = [txsIds, addresses, txsIds, addresses]
            subQuery2 = mysql.format(SUBQUERY_UTXOS_ADDR, parameters2)
            subQueries2.push(subQuery2)
        }

        if (xpubs && xpubs.length > 0) {
            const parameters2 = [txsIds, xpubs, txsIds, xpubs]
            subQuery2 = mysql.format(SUBQUERY_UTXOS_XPUB, parameters2)
            subQueries2.push(subQuery2)
        }

        subQuery2 = subQueries2.join(' UNION DISTINCT ')

        // Get inputs and outputs of interest
        const sqlQuery2 = 'SELECT * \
      FROM (' + subQuery2 + ') AS `utxos` \
      ORDER BY `utxos`.`outIndex` ASC, `utxos`.`inIndex` ASC'

        const utxos = await this._query(sqlQuery2)

        return this.assembleTransactions(txs, utxos)
    }

    /**
     * Initialize a transaction object returned as response to queries
     * @param {object} tx - transaction data retrieved from db
     * @returns {object} returns the transaction stub
     */
    _transactionStub(tx) {
        let returnValue = {
            hash: tx.txnTxid,
            time: (tx.time < 32503680000) ? tx.time : 0,
            version: tx.txnVersion,
            locktime: tx.txnLocktime,
            result: 0,
            inputs: [],
            out: []
        }

        if (tx.blockHeight != null)
            returnValue.block_height = tx.blockHeight

        return returnValue
    }

    /**
     * Initialize an input object returned as part of a response
     * @param {object} input - input data retrieved from db
     * @returns {object} returns the input stub
     */
    _inputStub(input) {
        let returnValue = {
            vin: input.inIndex,
            sequence: input.inSequence,
            prev_out: {
                txid: input.inOutTxid,
                vout: input.inOutIndex,
                value: input.inOutAmount,
                addr: input.inOutAddress
            }
        }

        if (input.hdXpub) {
            returnValue.prev_out.xpub = {
                m: input.hdXpub,
                path: ['M', input.hdAddrChain, input.hdAddrIndex].join('/')
            }
        }

        return returnValue
    }

    /**
     * Initialize an output object returned as part of a response
     * @param {object} output - output data retrieved from db
     * @returns {object} returns the output stub
     */
    _outputStub(output) {
        let returnValue = {
            n: output.outIndex,
            value: output.outAmount,
            addr: output.outAddress
        }

        if (output.hdXpub) {
            returnValue.xpub = {
                m: output.hdXpub,
                path: ['M', output.hdAddrChain, output.hdAddrIndex].join('/')
            }
        }

        return returnValue
    }

    /**
     * Take query results for txs and utxos and combine into transaction data
     * @param {object[]} txs - array of transaction data retrieved from db
     * @param {object[]} utxos - array of utxos data retrieved from db
     * @returns {object[]} returns an array of transaction objects
     */
    assembleTransactions(txs, utxos) {
        const txns = {}

        for (let tx of txs) {
            if (!txns[tx.txnID])
                txns[tx.txnID] = this._transactionStub(tx)
        }

        for (let u of utxos) {
            if (u.txnID != null && txns[u.txnID]) {
                if (u.inIndex != null) {
                    txns[u.txnID].result -= u.inOutAmount
                    txns[u.txnID].inputs.push(this._inputStub(u))
                } else if (u.outIndex != null) {
                    txns[u.txnID].result += u.outAmount
                    txns[u.txnID].out.push(this._outputStub(u))
                }
            }
        }

        // Return transactions in descending time order, most recent first
        const returnValue = Object.keys(txns).map(key => txns[key])
        returnValue.sort((a, b) => b.time - a.time)
        return returnValue
    }

    /**
     * Get a list of unspent outputs for given hd account
     * @param {string} xpub - xpub
     * @returns {Promise<object[]>} returns an array of utxos objects
     *  {txnTxid, txnVersion, txnLocktime, outIndex, outAmount, outScript, addrAddress}
     */
    async getHDAccountUnspentOutputs(xpub) {
        const sqlQuery = 'SELECT \
        `txnTxid`, \
        `txnVersion`, \
        `txnLocktime`, \
        `blockHeight`, \
        `outIndex`, \
        `outAmount`, \
        `outScript`, \
        `addrAddress`, \
        `hdAddrChain`, \
        `hdAddrIndex` \
      FROM `outputs` \
      INNER JOIN `addresses` ON `outputs`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd_addresses` ON `outputs`.`addrID` = `hd_addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      INNER JOIN `transactions` ON `outputs`.`txnID` = `transactions`.`txnID` \
      LEFT JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
      LEFT JOIN `inputs` ON `outputs`.`outID` = `inputs`.`outID` \
      WHERE `inputs`.`outID` IS NULL \
        AND `hd`.`hdXpub` = ?'

        return await this._query(sqlQuery, [xpub], true)
    }

    /**
     * Get addresses that belong to a given hd account
     * @param {string[]} addresses - array of bitcoin addresses
     * @returns {Promise<{ [string]: string }>} returns a dictionary {[address]: hdXpub, ...}
     */
    async getXpubByAddresses(addresses) {
        const returnValue = {}

        if (addresses.length === 0)
            return returnValue

        const sqlQuery = 'SELECT `hd`.`hdXpub`, `addresses`.`addrAddress` \
      FROM `addresses` \
      INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `addresses`.`addrAddress` IN (?)'

        const parameters = [addresses]
        const results = await this._query(sqlQuery, parameters)

        for (let r of results)
            returnValue[r.addrAddress] = r.hdXpub

        return returnValue
    }

    /**
     * Get the mysql ID of a transaction. Ensures that the transaction exists.
     * @param {string} txid - txid of a transaction
     * @returns {Promise<number>} returns the transaction id (mysql id)
     */
    async ensureTransactionId(txid) {
        const sqlQuery = 'INSERT IGNORE INTO `transactions` SET ?'
        const parameters = {
            txnTxid: txid,
            txnCreated: util.unix()
        }
        const result = await this._query(sqlQuery, parameters)

        // Successful insertion
        if (result.insertId > 0)
            return result.insertId

        // Transaction already in db
        const sqlQuery2 = 'SELECT `txnID` FROM `transactions` WHERE `txnTxid` = ?'
        const result2 = await this._query(sqlQuery2, [txid], true)

        if (result2.length > 0)
            return result2[0].txnID

        throw 'Problem met while trying to insert a new transaction'
    }

    /**
     * Get the mysql ID of a transaction
     * @param {string} txid - txid of a transaction
     * @returns {Promise<number | null>} returns the transaction id (mysql id)
     */
    async getTransactionId(txid) {
        const sqlQuery = 'SELECT `txnID` FROM `transactions` WHERE `txnTxid` = ?'
        const result = await this._query(sqlQuery, [txid], true)
        return (result.length === 0) ? null : result[0].txnID
    }

    /**
     * Get the mysql IDs of a collection of transactions
     * @param {string[]} txids - txids of the transactions
     * @returns {Promise<Record<string, number>>} returns an array of {txnTxid: txnId}
     */
    async getTransactionsIds(txids) {
        if (txids.length === 0)
            return {}

        const sqlQuery = 'SELECT `txnID`, `txnTxid` FROM `transactions` WHERE `txnTxid` IN (?)'
        const parameters = [txids]
        const results = await this._query(sqlQuery, parameters)

        const returnValue = {}
        for (let r of results)
            returnValue[r.txnTxid] = r.txnID
        return returnValue
    }

    /**
     * Get the mysql IDs of a set of transactions
     * @param {string[]} txnIDs - array of transactions txids
     * @returns {Promise<number[]>} returns an array of transaction ids (mysql ids)
     */
    async getTransactionsById(txnIDs) {
        if (txnIDs.length === 0)
            return []

        const sqlQuery = 'SELECT * FROM `transactions` WHERE `txnID` IN (?)'
        const parameters = [txnIDs]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Insert a new transaction in db
     * @param {{txid: string, version: number, locktime: number, created: number | undefined}} tx
     * @returns {Promise<unknown>}
     */
    async addTransaction(tx) {
        if (!tx.created)
            tx.created = util.unix()

        const sqlQuery = 'INSERT INTO `transactions` \
      (txnTxid, txnCreated, txnVersion, txnLocktime) VALUES (?) \
      ON DUPLICATE KEY UPDATE txnVersion = VALUES(txnVersion)'

        const parameters = [[
            tx.txid,
            tx.created,
            tx.version,
            tx.locktime
        ]]

        return await this._query(sqlQuery, parameters)
    }

    /**
     * Insert a collection of transactions in db
     * @param {{txid: string, version: number, locktime: number, created: number | undefined}[]} txs
     * @returns {Promise<unknown | void>}
     */
    async addTransactions(txs) {
        if (txs.length === 0)
            return

        const sqlQuery = 'INSERT INTO `transactions` \
      (txnTxid, txnCreated, txnVersion, txnLocktime) VALUES ? \
      ON DUPLICATE KEY UPDATE txnVersion = VALUES(txnVersion)'

        const parameters = [txs.map(tx => [
            tx.txid,
            tx.created || util.unix(),
            tx.version,
            tx.locktime
        ])]

        return await this._query(sqlQuery, parameters)
    }

    /**
     * Get a transaction for a given txid
     * @param {string} txid - txid of the transaction
     * @returns {Promise<object>}
     */
    async getTransaction(txid) {
        const results = await Promise.all([
            this._query(SUBQUERY_GET_TX_OUTS, [txid], true),
            this._query(SUBQUERY_GET_TX_INS, [txid], true)
        ])

        const tx = {
            hash: txid,
            time: Number.POSITIVE_INFINITY,
            version: 0,
            locktime: 0,
            inputs: [],
            out: [],
            block_height: null,
        }

        // Process the outputs
        for (let output of results[0]) {
            tx.version = output.txnVersion
            tx.locktime = output.txnLocktime

            if (output.blockTime != null)
                tx.time = Math.min(tx.time, output.blockTime)

            tx.time = Math.min(tx.time, output.txnCreated)

            if (output.blockHeight != null)
                tx.block_height = output.blockHeight

            const fmt = {
                n: output.outIndex,
                value: output.outAmount,
                addr: output.addrAddress,
                script: output.outScript,
            }

            if (output.hdXpub) {
                fmt.xpub = {
                    m: output.hdXpub,
                    path: ['M', output.hdAddrChain, output.hdAddrIndex].join('/')
                }
            }

            tx.out.push(fmt)
        }

        // Process the inputs
        for (let input of results[1]) {
            tx.version = input.txnVersion
            tx.locktime = input.txnLocktime

            if (input.blockTime != null)
                tx.time = Math.min(tx.time, input.blockTime)

            tx.time = Math.min(tx.time, input.txnCreated)

            if (input.blockHeight != null)
                tx.block_height = input.blockHeight

            const fmt = {
                vin: input.inIndex,
                prev_out: {
                    txid: input.prevOutTxid,
                    vout: input.outIndex,
                    value: input.outAmount,
                    addr: input.addrAddress,
                    script: input.outScript,
                },
                sequence: input.inSequence
            }

            if (input.hdXpub) {
                fmt.prev_out.xpub = {
                    m: input.hdXpub,
                    path: ['M', input.hdAddrChain, input.hdAddrIndex].join('/')
                }
            }

            tx.inputs.push(fmt)
        }

        // Remove block height if null
        if (tx.block_height == null)
            delete tx.block_height

        return tx
    }

    /**
     * Get the unconfirmed transactions
     * @returns {Promise<object[]>} returns an array of transactions data
     */
    async getUnconfirmedTransactions() {
        const query = 'SELECT * FROM `transactions` WHERE blockID IS NULL'
        return await this._query(query)
    }

    /**
     * Get all transactions
     * @returns {Promise<object[]>} returns an array of transactions data
     */
    async getTransactions() {
        const query = 'SELECT * FROM `transactions`'
        return await this._query(query)
    }

    /**
     * Get the inputs of a transaction
     * @param {string} txnID - mysql id of the transaction
     * @returns {Promise<object[]>} returns an array of inputs
     */
    async getTxInputs(txnID) {
        const sqlQuery = 'SELECT * FROM `inputs` WHERE `txnID` = ?'
        return await this._query(sqlQuery, [txnID], true)
    }

    /**
     * Batch confirm txids in a block
     * @param {string[]} txnTxidArray - array of transaction txids
     * @param {number} blockID - mysql id of the blck
     * @returns {Promise<unknown>}
     */
    async confirmTransactions(txnTxidArray, blockID) {
        if (txnTxidArray.length === 0)
            return

        const sqlQuery = 'UPDATE `transactions` SET `blockID` = ? WHERE `txnTxid` IN (?)'
        const parameters = [blockID, txnTxidArray]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Get the transactions confirmed after a given height
     * @param {number} height - block height
     * @returns {Promise<object[]>} returns an array of transactions
     */
    async getTransactionsConfirmedAfterHeight(height) {
        const sqlQuery = 'SELECT `transactions`.* FROM `transactions` \
      INNER JOIN `blocks` ON `blocks`.`blockID` = `transactions`.`blockID` \
      WHERE `blocks`.`blockHeight` > ?'
        return await this._query(sqlQuery, [height], true)
    }

    /**
     * Delete the transactions confirmed after a given height
     * @param {number} height - block height
     * @returns {Promise<unknown>}
     */
    async deleteTransactionsConfirmedAfterHeight(height) {
        const sqlQuery = 'DELETE `transactions`.* FROM `transactions` \
      INNER JOIN `blocks` ON `blocks`.`blockID` = `transactions`.`blockID` \
      WHERE `blocks`.`blockHeight` > ?'
        return await this._query(sqlQuery, [height])
    }

    /**
     * Batch unconfirm a set of transactions
     * @param {string[]} txnTxidArray - array of transaction txids
     * @returns {Promise<unknown>}
     */
    async unconfirmTransactions(txnTxidArray) {
        if (txnTxidArray.length === 0)
            return

        const sqlQuery = 'UPDATE `transactions` SET `blockID` = NULL WHERE `txnTxid` IN (?)'
        const parameters = [txnTxidArray]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Delete a transaction identified by its txid
     * @param {string} txid - txid of the transaction
     * @returns {Promise<unknown>}
     */
    async deleteTransaction(txid) {
        const sqlQuery = 'DELETE `transactions`.* FROM `transactions` WHERE `transactions`.`txnTxid` = ?'
        return await this._query(sqlQuery, [txid])
    }

    /**
     * Delete a set of transactions identified by their mysql ids
     * @param {number[]} txnIDs - mysql ids of the transactions
     * @returns {Promise<unknown>}
     */
    async deleteTransactionsByID(txnIDs) {
        if (txnIDs.length === 0)
            return []

        const sqlQuery = 'DELETE `transactions`.* FROM `transactions` WHERE `transactions`.`txnID` in (?)'
        const parameters = [txnIDs]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Insert transaction outputs associated with known addresses
     * @param {object[]} outputs - array of {txnID, addrID, outIndex, outAmount, outScript}
     * @returns {Promise<number[]>}
     */
    async addOutputs(outputs) {
        if (outputs.length === 0)
            return

        const sqlQuery = 'INSERT IGNORE INTO `outputs` \
      (txnID, addrID, outIndex, outAmount, outScript) VALUES ?'

        const parameters = [outputs.map(o => [o.txnID, o.addrID, o.outIndex, o.outAmount, o.outScript])]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Get a list of outputs identified by their txid and index.
     * The presence of spendingTxnID and spendingInID not null indicate that an
     * input spending the transaction output index is already in the database and
     * may indicate a DOUBLE SPEND.
     * @param {object[]} spends - array of {txid,index}
     * @returns {Promise<object[]>} returns a array of output objects
     *  {addrAddress, outID, outAmount, txnTxid, outIndex, spendingTxnID/null, spendingInID/null}
     */
    async getOutputSpends(spends) {
        if (spends.length === 0)
            return []

        const whereClauses =
            spends.map(s => '(`txnTxid`=' + this.pool.escape(s.txid) + ' AND `outIndex`=' + this.pool.escape(s.index) + ')')

        const whereClause = whereClauses.join(' OR ')

        const sqlQuery = 'SELECT \
        `addrAddress`, \
        `outputs`.`outID`, \
        `outAmount`, \
        `txnTxid`, \
        `outIndex`, \
        `inputs`.`txnID` AS `spendingTxnID` \
      FROM `outputs` \
      INNER JOIN `addresses` ON `outputs`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `transactions` ON `outputs`.`txnID` = `transactions`.`txnID` \
      LEFT JOIN `inputs` ON `inputs`.`outID` = `outputs`.outID \
      WHERE ' + whereClause

        return await this._query(sqlQuery)
    }

    /**
     * Get a list of mysql ids for outputs identified by their txid and index.
     * @param {object[]} spends - array of {txid,vout}
     * @returns {Promise<object[]>} returns a array of output objects
     *  {outID, txnTxid, outIndex}
     */
    async getOutputIds(spends) {
        if (spends.length === 0)
            return []

        const whereClauses =
            spends.map((s) => '(`txnTxid`=' + this.pool.escape(s.txid) + ' AND `outIndex`=' + this.pool.escape(s.vout) + ')')

        const whereClause = whereClauses.join(' OR ')

        const sqlQuery = 'SELECT \
        `outID`, \
        `txnTxid`, \
        `outIndex` \
      FROM `outputs` \
      INNER JOIN `transactions` ON `outputs`.`txnID` = `transactions`.`txnID` \
      WHERE ' + whereClause

        return await this._query(sqlQuery)
    }

    /**
     * Get a list of unspent outputs for a list of addresses
     * @param {string[]} addresses - array of bitcoin addresses
     * @returns {Promise<object[]>} returns a array of output objects
     *  {txnTxid, outIndex, outAmount, outScript, addrAddress}
     */
    async getUnspentOutputs(addresses) {
        if (addresses.length === 0)
            return []

        const sqlQuery = 'SELECT \
        `txnTxid`, \
        `txnVersion`, \
        `txnLocktime`, \
        `blockHeight`, \
        `outIndex`, \
        `outAmount`, \
        `outScript`, \
        `addrAddress` \
      FROM `outputs` \
      INNER JOIN `addresses` ON `outputs`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `transactions` ON `outputs`.`txnID` = `transactions`.`txnID` \
      LEFT JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
      LEFT JOIN `inputs` ON `outputs`.`outID` = `inputs`.`outID` \
      WHERE `inputs`.`outID` IS NULL \
        AND (`addrAddress`) IN (?)'

        const parameters = [addresses]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Insert transaction inputs that spend known Outputs
     * @param {{txnID: number, outID: number, inIndex: number, inSequence: number}[]} inputs - array of input objects
     *  @returns {Promise<unknown>}
     */
    async addInputs(inputs) {
        if (inputs.length === 0)
            return

        const sqlQuery = 'INSERT INTO `inputs` \
      (txnID, outID, inIndex, inSequence) VALUES ? \
      ON DUPLICATE KEY UPDATE outID = VALUES(outID)'

        const parameters = [inputs.map((index) => [index.txnID, index.outID, index.inIndex, index.inSequence])]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Insert a new block
     * @param {{blockHash: string, blockParent: number, blockHeight: number, blockTime: number}} block - block object
     * block.blockParent is an ID, which may be obtained with DB.getBlockByHash
     * @returns {Promise<unknown>}
     */
    async addBlock(block) {
        const sqlQuery = 'INSERT IGNORE INTO `blocks` SET ?'
        const result = await this._query(sqlQuery, [block])

        // Successful insertion
        if (result.insertId > 0)
            return result.insertId

        // Block already in db
        const sqlQuery2 = 'SELECT `blockID` FROM `blocks` WHERE `blockHash` = ?'
        const parameters2 = [block.blockHash]
        const result2 = await this._query(sqlQuery2, parameters2)

        if (result2.length > 0)
            return result2[0].blockID

        throw 'Problem met while trying to insert a new block'
    }

    /**
     * Get a block identified by the block hash
     * @param {string} hash - block hash
     * @returns {Promise<object>} returns the block
     */
    async getBlockByHash(hash) {
        const sqlQuery = 'SELECT * FROM `blocks` WHERE `blockHash` = ?'
        const result = await this._query(sqlQuery, [hash], true)
        return (result.length === 1) ? result[0] : null
    }

    /**
     * Get a collection of blocks identified by the blocks hashes
     * @param {string[]} hashes - blocks hashes
     * @returns {Promise<object[]>} returns the blocks
     */
    async getBlocksByHashes(hashes) {
        if (hashes.length === 0)
            return []

        const sqlQuery = 'SELECT * FROM `blocks` WHERE `blockHash` IN (?)'
        const parameters = [hashes]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Get details about all blocks at a given block height
     * @param {number} height - block height
     * @returns {Promise<object[]>} returns an array of blocks
     */
    async getBlocksByHeight(height) {
        const sqlQuery = 'SELECT * FROM `blocks` WHERE `blockHeight` = ?'
        return await this._query(sqlQuery, [height], true)
    }

    /**
     * Delete the blocks after a given block height
     * @param {number} height - block height
     * @returns {Promise<unknown>}
     */
    async deleteBlocksAfterHeight(height) {
        const sqlQuery = 'DELETE FROM `blocks` WHERE `blockHeight` > ?'
        return await this._query(sqlQuery, [height])
    }

    /**
     * Gets the last block
     * @returns {Promise<{ blockID: number | null, blockHeight: number }>} returns the last block
     */
    async getHighestBlock() {
        try {
            const results = await this.getLastBlocks(1)
            return results == null || results.length === 0 ? {
                blockID: null,
                blockHeight: 0
            } : results[0]
        } catch (error) {
            Logger.error(error, 'Db Wrapper : getHighestBlock() : Failed to get highest block from the DB')
            return {
                blockID: null,
                blockHeight: 0
            }
        }
    }

    /**
     * Gets the N last blocks
     * @param {number} n - number of blocks to be retrieved
     * @returns {Promise<object[]>} returns an array of the n last blocks
     */
    async getLastBlocks(n) {
        const sqlQuery = 'SELECT * FROM `blocks` ORDER BY `blockHeight` DESC LIMIT ?'
        return await this._query(sqlQuery, n)
    }


    /**
     * Get all scheduled transactions
     * @returns {Promise<object[]>} returns an array of scheduled transactions
     */
    async getScheduledTransactions() {
        const sqlQuery = 'SELECT * FROM `scheduled_transactions` ORDER BY `schTrigger`, `schCreated`'
        return await this._query(sqlQuery)
    }

    /**
     * Get the mysql ID of a scheduled transaction
     * @param {string} txid - txid of a scheduled transaction
     * @returns {Promise<number>} returns the scheduled transaction id (mysql id)
     */
    async getScheduledTransactionId(txid) {
        const sqlQuery = 'SELECT `schID` FROM `scheduled_transactions` WHERE `schTxid` = ?'
        const result = await this._query(sqlQuery, [txid], true)
        return (result.length === 0) ? null : result[0].txnID
    }

    /**
     * Insert a new scheduled transaction in db
     * @param {object} tx - {txid, created, rawTx, parentId, delay, trigger}
     * @returns {Promise<unknown>}
     */
    async addScheduledTransaction(tx) {
        if (!tx.created)
            tx.created = util.unix()

        const sqlQuery = 'INSERT INTO `scheduled_transactions` \
      (schTxid, schCreated, schRaw, schParentID, schParentTxid, schDelay, schTrigger) VALUES (?)'

        const parameters = [[
            tx.txid,
            tx.created,
            tx.rawTx,
            tx.parentId,
            tx.parentTxid,
            tx.delay,
            tx.trigger
        ]]

        const result = await this._query(sqlQuery, parameters)

        if (result.insertId > 0)
            return result.insertId

        throw 'Problem met while trying to insert a new scheduled transaction'
    }

    /**
     * Delete a scheduled transaction
     * @param {string} txid - scheduled transaction txid
     * @returns {Promise<unknown>}
     */
    async deleteScheduledTransaction(txid) {
        const sqlQuery = 'DELETE `scheduled_transactions`.* \
      FROM `scheduled_transactions` \
      WHERE `scheduled_transactions`.`schTxid` = ?'
        return await this._query(sqlQuery, [txid])
    }

    /**
     * Get scheduled transactions
     * with a trigger lower than a given block height
     * @param {Promise<number>} height - block height
     */
    async getActivatedScheduledTransactions(height) {
        const sqlQuery = 'SELECT * FROM `scheduled_transactions` \
      WHERE `schTrigger` <= ? AND `schParentID` IS NULL'
        return await this._query(sqlQuery, [height], true)
    }

    /**
     * Get the scheduled transaction having a given parentID
     * @param {number} parentId - parent ID
     * @returns {Promise<object[]>} returns an array of scheduled transactions
     */
    async getNextScheduledTransactions(parentId) {
        const sqlQuery = 'SELECT * FROM `scheduled_transactions` \
      WHERE `schParentID` = ?'
        return await this._query(sqlQuery, [parentId], true)
    }

    /**
     * Update the trigger of a scheduled transaction
     * identified by its ID
     * @param {number} id - id of the scheduled transaction
     * @param {Promise<unknown>} trigger - new trigger
     */
    async updateTriggerScheduledTransaction(id, trigger) {
        const sqlQuery = 'UPDATE `scheduled_transactions` \
      SET `schTrigger` = ? \
      WHERE `schID` = ?'
        const parameters = [trigger, id]
        return await this._query(sqlQuery, parameters)
    }

    /**
     * Get one API key
     * @param {string} apikey
     * @returns {Promise<number | null>}
     */
    async getApiKeyID(apikey) {
        const sqlQuery = 'SELECT `apikeyID` FROM `api_keys` WHERE `apikey` = ?'
        const result = await this._query(sqlQuery, [apikey], true)
        return (result.length === 0) ? null : result[0].apikeyID
    }

    /**
     * Get all API keys
     * @returns {Promise<{ apikeyID: number; label: string, apikey: string, active: boolean, createdAt: Date, expiresAt: Date }[]>}
     */
    async getApiKeys() {
        const sqlQuery = 'SELECT * FROM `api_keys`'
        const results = await this._query(sqlQuery, true)

        return results.map((row) => ({
            ...row,
            active: Boolean(row.active)
        }))
    }

    /**
     * Get active API keys
     * @returns {Promise<{ apikeyID: number; label: string, apikey: string, active: number, createdAt: Date, expiresAt: Date }[]>}
     */
    async getActiveApiKeys() {
        const sqlQuery = 'SELECT * \
                                 FROM `api_keys` \
                                 WHERE `active` = TRUE \
                                 AND `expiresAt` > CURRENT_TIMESTAMP'
        return await this._query(sqlQuery, true)
    }

    /**
     * Create a new API key
     * @param {string} label
     * @param {string} apikey
     * @param {Date} expiresAt
     * @returns {Promise<any>}
     */
    async createApiKey(label, apikey, expiresAt) {
        const sqlQuery = 'INSERT INTO `api_keys` (label, apikey, expiresAt) VALUES (?, ?, ?)'

        return await this._query(sqlQuery, [label, apikey, expiresAt])
    }

    /**
     * Create a new API key
     * @param {number} apikeyID
     * @param {string} label
     * @param {boolean} active
     * @param {Date} expiresAt
     * @returns {Promise<any>}
     */
    async updateApiKey(apikeyID, label, active, expiresAt) {
        const sqlQuery = 'UPDATE `api_keys` SET label = ?, active = ?, expiresAt = ? WHERE apikeyID = ?'

        return await this._query(sqlQuery, [label, active, expiresAt, apikeyID])
    }

    /**
     * Delete API key
     * @param {string} apikey
     * @returns {Promise<any>}
     */
    async deleteApiKey(apikey) {
        const sqlQuery = 'DELETE FROM `api_keys` WHERE `apikey` = ?'
        return await this._query(sqlQuery, [apikey])
    }

    /**
     * MAINTENANCE FUNCTIONS
     */

    async getInvalidAccountTimes() {
        const sqlQuery = 'SELECT \
        `hd`.`hdID`, \
        `hdCreated`, \
        min(`txnCreated`) as `earliest` \
      FROM `hd` \
      INNER JOIN `hd_addresses` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      INNER JOIN `addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `outputs` ON `outputs`.`addrID` = `hd_addresses`.`addrID` \
      INNER JOIN `transactions` ON `outputs`.`txnID` = `transactions`.`txnID` \
      WHERE `hd`.`hdCreated` > `transactions`.`txnCreated` \
      GROUP BY `hd`.`hdID` LIMIT 100'

        return await this._query(sqlQuery)
    }

    async getInvalidTxTimes() {
        const sqlQuery = 'SELECT \
        `txnID`, \
        `txnCreated`, \
        `blockTime` \
      FROM `transactions` \
      INNER JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
      WHERE `transactions`.`txnCreated` > `blocks`.`blockTime` \
      LIMIT 100'

        return await this._query(sqlQuery)
    }

    async setHDTime(hdID, hdCreated) {
        const sqlQuery = 'UPDATE `hd` SET `hdCreated` = ? WHERE `hdID` = ?'
        const parameters = [hdCreated, hdID]
        return await this._query(sqlQuery, parameters)
    }

    async setTransactionTime(txnID, txnCreated) {
        const sqlQuery = 'UPDATE `transactions` SET `txnCreated` = ? WHERE `txnID` = ?'
        const parameters = [txnCreated, txnID]
        return await this._query(sqlQuery, parameters)
    }

    async updateInputSequence(inID, inSequence) {
        const sqlQuery = 'UPDATE `inputs` SET `inSequence` = ? WHERE `inID` = ?'
        const parameters = [inSequence, inID]
        return await this._query(sqlQuery, parameters)
    }

    async getOutputsWithoutScript() {
        const sqlQuery = 'SELECT \
        `txnTxid`, \
        `outIndex`, \
        `outId` \
      FROM `outputs` \
      INNER JOIN `transactions` ON `outputs`.`txnID` = `transactions`.`txnID` \
      WHERE length(`outputs`.`outScript`) = 0 \
      ORDER BY `outId` \
      LIMIT 100'

        return await this._query(sqlQuery)
    }

    async updateOutputScript(outID, outScript) {
        const sqlQuery = 'UPDATE `outputs` SET `outScript` = ? WHERE `outID` = ?'
        const parameters = [outScript, outID]
        return await this._query(sqlQuery, parameters)
    }

    async setBlockParent(hash, blockID) {
        const sqlQuery = 'UPDATE `blocks` SET `blockParent` = ? WHERE `blockHash` = ?'
        const parameters = [blockID, hash]
        return await this._query(sqlQuery, parameters)
    }

}

export default new MySqlDbWrapper()

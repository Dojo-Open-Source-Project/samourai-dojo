/*!
 * lib/db.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import mysql, { type Pool, type PoolOptions, type SqlValue } from "mysql2";
import keysFile from "../../keys/index.js";
import hdaHelper from "../bitcoin/hd-accounts-helper.js";
import network from "../bitcoin/network.js";
import errors from "../errors.js";
import Logger from "../logger.js";
import util from "../util.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;
const debug = process.argv.includes("db-debug");
const queryDebug = process.argv.includes("dbquery-debug");

/**
 * @typedef {import('mysql2').Pool} MySqlPool
 * @typedef {import('mysql2').PoolOptions} MySqlPoolOptions
 * @typedef {import('mysql2').FieldPacket} MySqlFieldPacket
 */

/**
 * Subqueries used by getAddrAndXpubsNbTransactions()
 */
const SUBQUERY_TXIDS_ADDR =
	"( \
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
)";

const SUBQUERY_TXIDS_XPUBS =
	"( \
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
)";

/**
 * Subqueries used by getTxsByAddrAndXpubs()
 */
const SUBQUERY_TXS_ADDR =
	"(\
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
)";

const SUBQUERY_TXS_XPUB =
	"(\
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
)";

const SUBQUERY_UTXOS_ADDR =
	"(\
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
)";

const SUBQUERY_UTXOS_XPUB =
	"(\
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
)";

const SUBQUERY_GET_TX_OUTS =
	"SELECT \
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
  ORDER BY `outputs`.`outIndex` ASC";

const SUBQUERY_GET_TX_INS =
	"SELECT \
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
  ORDER BY `inputs`.`inIndex` ASC";

const defaultConfig: PoolOptions = {
	decimalNumbers: true,
	namedPlaceholders: true,
};

type DbScalar = string | number | boolean | Date | Buffer | null | undefined;
type DbQueryValues = unknown;
type MySqlFormatValues =
	| SqlValue
	| SqlValue[]
	| SqlValue[][]
	| Record<string, SqlValue | SqlValue[]>;
type DbCell = string | number | boolean | Date | Buffer | null;

export interface DbRow {
	[column: string]: DbCell;
	addrID: number;
	addrAddress: string;
	hdID: number;
	hdXpub: string;
	hdCreated: number;
	hdType: number;
	hdAddrChain: number;
	hdAddrIndex: number;
	balance: number | null;
	nbTxs: number | null;
	nextUnusedIndex: number | null;
	maxDerivedIndex: number | null;
	nbDerivedIndices: number | null;
	txnID: number;
	txnTxid: string;
	txnCreated: number;
	txnVersion: number;
	txnLocktime: number;
	blockID: number | null;
	blockHash: string;
	blockHeight: number;
	blockTime: number | null;
	blockParent: number | null;
	time: number;
	outID: number;
	outId: number;
	outIndex: number;
	outAmount: number;
	outAddress: string;
	outScript: string;
	inID: number;
	inIndex: number;
	inSequence: number;
	inOutTxid: string;
	inOutIndex: number;
	inOutAmount: number;
	inOutAddress: string;
	prevOutTxid: string;
	spendingTxnID: number | null;
	schID: number;
	schTxid: string;
	schCreated: number;
	schRaw: string;
	schParentID: number | null;
	schParentTxid: string | null;
	schDelay: number;
	schTrigger: number;
	apikeyID: number;
	apikey: string;
	label: string;
	active: number | boolean;
	createdAt: Date;
	expiresAt: Date;
	earliest: number;
	chainTipHeight: number | null;
}

export type DbRows = DbRow[];

interface DbWriteResult {
	insertId: number;
	affectedRows?: number;
	changedRows?: number;
	warningStatus?: number;
}

type DbQueryResult = DbRows & DbWriteResult;

type DbConfig = PoolOptions & {
	host?: string;
	socketPath?: string;
	connectionLimit?: number;
};

interface DbConnectionInfo {
	threadId: number;
}

interface DbErrorWithCode {
	code?: string;
}

const hasMysqlCode = (error: unknown): error is DbErrorWithCode =>
	error != null && typeof error === "object" && "code" in error;

interface HdAddressData {
	address: string;
	chain: number;
	index: number;
}

interface OutputSpendRef {
	txid: string;
	index?: number;
	vout?: number;
}

interface NewOutput {
	txnID: number;
	addrID: number;
	outIndex: number;
	outAmount: number;
	outScript: string;
}

interface NewInput {
	txnID: number;
	outID: number;
	inIndex: number;
	inSequence: number;
}

interface NewBlock {
	blockHash: string;
	blockParent: number | null;
	blockHeight: number;
	blockTime: number;
}

interface NewTransaction {
	txid: string;
	version: number;
	locktime: number;
	created?: number;
}

interface NewScheduledTransaction {
	txid: string;
	created?: number;
	rawTx: string;
	parentId?: number | null;
	parentTxid?: string | null;
	delay?: number | null;
	trigger: number;
}

export interface ApiXpubInfo {
	m: string;
	path: string;
}

export interface ApiPrevOut {
	txid: string;
	vout: number;
	value: number;
	addr: string;
	script?: string;
	xpub?: ApiXpubInfo;
}

export interface ApiInput {
	vin: number;
	sequence: number;
	prev_out: ApiPrevOut;
}

export interface ApiOutput {
	n: number;
	value: number;
	addr: string;
	script?: string;
	xpub?: ApiXpubInfo;
}

export interface ApiTransaction {
	hash: string | undefined;
	time: number;
	version: number;
	locktime: number;
	result?: number;
	inputs: ApiInput[];
	out: ApiOutput[];
	block_height?: number | null;
}

/**
 * A singleton providing a MySQL db wrapper
 * Node-mysql doc: https://github.com/felixge/node-mysql
 */
class MySqlDbWrapper {
	declare dbConfig: DbConfig | null;
	declare pool: Pool | null;
	declare lockReconnect: boolean;
	declare timerReconnect: ReturnType<typeof setTimeout> | null;
	/**
	 * Constructor
	 */
	constructor() {
		/**
		 * @type {MySqlPoolOptions | null}
		 */
		this.dbConfig = null;
		// Db connections pool
		/**
		 * @type {MySqlPool | null}
		 */
		this.pool = null;
		// Lock preventing multiple reconnects
		this.lockReconnect = false;
		// Timer managing reconnects
		this.timerReconnect = null;
	}

	/**
	 * Connect the wrapper to the database
	 */
	connect(dbConfig: DbConfig = {}) {
		if (dbConfig.host?.includes(".sock")) {
			dbConfig.socketPath = dbConfig.host;
		}

		this.dbConfig = { ...defaultConfig, ...dbConfig };

		try {
			if (this.pool) this.handleReconnect();
			else this.handleConnect();
		} catch {
			this.handleReconnect();
		}
	}

	/**
	 * Disconnect wrapper from the database
	 */
	disconnect() {
		return new Promise<void>((resolve) => {
			if (this.pool) {
				this.pool.end((err?: unknown) => {
					if (err) {
						Logger.error(err, "DB Wrapper : Error when disconnecting from DB");
					}

					this.pool = null;
					resolve();
				});
			}

			resolve();
		});
	}

	/**
	 * Connect the wrapper to the mysql server
	 */
	handleConnect() {
		try {
			if (this.dbConfig == null) throw new Error("Database config is missing");
			this.pool = mysql.createPool(this.dbConfig);
			Logger.info(
				`Db Wrapper : Created a database pool of ${this.dbConfig.connectionLimit} connections`,
			);

			if (debug) {
				this.pool.on("acquire", (conn: DbConnectionInfo) => {
					Logger.info(`Db Wrapper : Connection ${conn.threadId} acquired`);
				});
				this.pool.on("enqueue", () => {
					Logger.info("Db Wrapper : Waiting for a new connection slot");
				});
				this.pool.on("release", (conn: DbConnectionInfo) => {
					Logger.info(`Db Wrapper : Connection ${conn.threadId} released`);
				});
			}
		} catch (error) {
			Logger.error(
				error,
				"Db Wrapper : handleConnect() : Problem met while trying to initialize a new pool",
			);
			throw error;
		}
	}

	/**
	 * Reconnect the wrapper to the mysql server
	 */
	handleReconnect() {
		if (this.pool) {
			// Manage the lock
			if (this.lockReconnect) return;

			this.lockReconnect = true;

			if (this.timerReconnect) clearTimeout(this.timerReconnect);

			// Destroy previous pool
			this.pool.end((error?: unknown) => {
				if (error) {
					Logger.error(
						error,
						"Db Wrapper : handleReconnect() : Problem met while terminating the pool",
					);
					this.timerReconnect = setTimeout(() => this.handleReconnect(), 2000);
				} else {
					this.handleConnect();
				}
				this.lockReconnect = false;
			});
		}
	}

	/**
	 * @description Send a query
	 * @return {Promise<unknown[] | unknown>}
	 */
	async _query<T extends DbQueryResult = DbQueryResult>(
		query: string,
		values?: DbQueryValues,
		usePrepare = false,
		retries = 5,
	): Promise<T> {
		const sqlValues = values as MySqlFormatValues;
		queryDebug && Logger.info(`Db Wrapper : ${mysql.format(query, sqlValues)}`);

		if (this.pool == null) throw new Error("Database pool is not initialized");
		const promisePool = this.pool.promise();

		try {
			const [result] = usePrepare
				? await promisePool.execute(
						query,
						sqlValues as Parameters<typeof promisePool.execute>[1],
					)
				: await promisePool.query(mysql.format(query, sqlValues));

			queryDebug && Logger.info(`Db Wrapper : ${JSON.stringify(result)}`);

			return result as T;
		} catch (error) {
			// Retry the request on lock errors
			if (
				hasMysqlCode(error) &&
				(error.code === "ER_LOCK_DEADLOCK" ||
					error.code === "ER_LOCK_TIMEOUT" ||
					error.code === "ER_LOCK_WAIT_TIMEOUT") &&
				retries > 0
			) {
				this.queryError(
					new Error("Lock detected. Retry request in a few ms"),
					mysql.format(query, sqlValues),
				);
				await util.delay(Math.floor(Math.random() * 100 + 1));
				return await this._query(query, values, usePrepare, retries - 1);
			}

			this.queryError(error, mysql.format(query, sqlValues));
			throw error;
		}
	}

	/**
	 * @description Log a query error
	 */
	queryError(error?: unknown, query?: unknown) {
		Logger.error(error, "Db Wrapper : query() : Query Error");
		Logger.error(null, `Db Wrapper : ${query}`);
	}

	/**
	 * Get the ID of an address
	 */
	async getAddressId(address?: string) {
		const sqlQuery = "SELECT `addrID` FROM `addresses` WHERE `addrAddress` = ?";
		const result = await this._query(sqlQuery, [address], true);

		if (result.length > 0) return result[0].addrID;

		throw errors.db.ERROR_NO_ADDRESS;
	}

	/**
	 * Get the ID of an Address. Ensures that the address exists.
	 */
	async ensureAddressId(address?: string) {
		const sqlQuery = "SELECT `addrID` FROM `addresses` WHERE `addrAddress` = ?";
		const result = await this._query(sqlQuery, [address], true);

		if (result.length > 0) return result[0].addrID;

		const sqlQuery2 = "INSERT INTO `addresses` SET ?";
		const parameters2 = { addrAddress: address };
		const result2 = await this._query(sqlQuery2, parameters2);
		return result2.insertId;
	}

	/**
	 * Get the IDs of an array of Addresses
	 */
	async getAddressesIds(addresses: string[] = []) {
		const returnValue: Record<string, number> = {};

		if (addresses.length === 0) return returnValue;

		const sqlQuery = "SELECT * FROM `addresses` WHERE `addrAddress` IN (?)";
		const parameters = [addresses];
		const result = await this._query(sqlQuery, parameters);

		for (const r of result) returnValue[r.addrAddress] = r.addrID;

		return returnValue;
	}

	/**
	 * Bulk insert addresses.
	 */
	async addAddresses(
		addresses: string[] = [],
	): Promise<DbRows | DbQueryResult> {
		if (addresses.length === 0) return [] as DbRows;

		const sqlQuery = "INSERT IGNORE INTO `addresses` (addrAddress) VALUES ?";
		const parameters = [addresses.map((address): DbScalar[] => [address])];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Bulk select address entries
	 */
	async getAddresses(addresses: string[] = []): Promise<DbRows> {
		if (addresses.length === 0) return [] as DbRows;

		const sqlQuery = "SELECT * FROM `addresses` WHERE `addrAddress` IN (?)";
		const parameters = [addresses];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Get address balance.
	 */
	async getAddressBalance(address?: string) {
		if (address == null) return null;

		const sqlQuery =
			"SELECT SUM(`outputs`.`outAmount`) as balance \
      FROM `addresses` \
      INNER JOIN `outputs` ON `outputs`.`addrID` = `addresses`.`addrID`  \
      LEFT JOIN `inputs` ON `outputs`.`outID` = `inputs`.`outID` \
      WHERE \
        `inputs`.`outID` IS NULL AND \
        `addresses`.`addrAddress` = ?";

		const results = await this._query(sqlQuery, [address], true);

		if (results.length === 1) {
			const balance = results[0].balance;
			return balance == null ? 0 : balance;
		}

		return null;
	}

	/**
	 * Get the number of transactions for an address.
	 */
	async getAddressNbTransactions(address?: string) {
		if (address == null) return null;

		const sqlQuery =
			"SELECT COUNT(DISTINCT `r`.`txnTxid`) AS nbTxs \
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
      ) AS `r`";

		const parameters = [address, address];
		const results = await this._query(sqlQuery, parameters, true);

		if (results.length === 1) {
			const nbTxs = results[0].nbTxs;
			return nbTxs == null ? 0 : nbTxs;
		}

		return null;
	}

	/**
	 * Get an HD account.
	 */
	async getHDAccount(xpub?: string) {
		const sqlQuery = "SELECT * FROM `hd` WHERE `hdXpub` = ?";
		const result = await this._query(sqlQuery, [xpub], true);

		if (result.length > 0) return result[0];

		throw errors.db.ERROR_NO_HD_ACCOUNT;
	}

	/**
	 * Get the ID of an HD account
	 */
	async getHDAccountId(xpub?: string) {
		const sqlQuery = "SELECT `hdID` FROM `hd` WHERE `hdXpub` = ?";
		const result = await this._query(sqlQuery, [xpub], true);

		if (result.length > 0) return result[0].hdID;

		throw errors.db.ERROR_NO_HD_ACCOUNT;
	}

	/**
	 * Get the ID of an HD account. Ensures that the account exists.
	 */
	async ensureHDAccountId(xpub?: string, type?: number) {
		const info = hdaHelper.classify(type);

		if (info.type === null) throw errors.xpub.SEGWIT;

		// Get the ID of the xpub
		const sqlQuery = "SELECT `hdID` FROM `hd` WHERE `hdXpub` = ?";
		const result = await this._query(sqlQuery, [xpub], true);

		if (result.length > 0) return result[0].hdID;

		const sqlQuery2 = "INSERT INTO `hd` SET ?";
		const parameters2 = {
			hdXpub: xpub,
			hdCreated: util.unix(),
			hdType: type,
		};
		const result2 = await this._query(sqlQuery2, parameters2);
		return result2.insertId;
	}

	/**
	 * Lock the type of a hd account
	 */
	async setLockHDAccountType(xpub?: string, locked?: boolean) {
		const account = await this.getHDAccount(xpub);
		const info = hdaHelper.classify(account.hdType);

		if (info.locked === locked) return true;

		const hdType = hdaHelper.makeType(account.hdType, locked);
		const sqlQuery = "UPDATE `hd` SET `hdType` = ? WHERE `hdXpub` = ?";
		const parameters = [hdType, xpub];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Delete a hd account
	 */
	async deleteHDAccount(xpub?: string) {
		try {
			// Check that this HD account exists
			await this.getHDAccountId(xpub);

			// Delete addresses associated with this xpub.
			// Address deletion cascades into transaction inputs & outputs.
			const sqlQuery =
				"DELETE `addresses`.* FROM `addresses` \
        INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
        INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
        WHERE `hd`.`hdXpub` = ?";

			await this._query(sqlQuery, [xpub]);

			// Delete HD account entry
			const sqlQuery2 = "DELETE FROM `hd` WHERE `hdXpub` = ?";

			return await this._query(sqlQuery2, [xpub]);
		} catch (error) {
			Logger.error(error, "Db Wrapper : deleteHDAccount()");
		}
	}

	/**
	 * Add an address a hd account
	 */
	async addAddressToHDAccount(
		address?: string,
		xpub?: string,
		chain?: number,
		index?: number,
	) {
		const results = await Promise.all([
			this.ensureAddressId(address),
			this.getHDAccountId(xpub),
		]);

		const addrID = results[0];
		const hdID = results[1];

		if (hdID == null) throw null;

		const sqlQuery = "INSERT INTO `hd_addresses` SET ?";
		const parameters = {
			hdID: hdID,
			addrID: addrID,
			hdAddrChain: chain,
			hdAddrIndex: index,
		};

		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Bulk-add addresses to an HD account.
	 */
	async addAddressesToHDAccount(
		xpub?: string,
		addressData: HdAddressData[] = [],
	) {
		if (addressData.length === 0) return;

		const addresses = addressData.map((d) => d.address);
		const hdID = await this.getHDAccountId(xpub);

		// Bulk insert addresses
		await this.addAddresses(addresses);

		// Bulk get address IDs
		const addrIdMap = await this.getAddressesIds(addresses);

		// Convert input addressData into database entry format
		const data: DbScalar[][] = [];
		for (const entry of addressData) {
			data.push([hdID, addrIdMap[entry.address], entry.chain, entry.index]);
		}

		const sqlQuery =
			"INSERT IGNORE INTO `hd_addresses` \
      (hdID, addrID, hdAddrChain, hdAddrIndex) VALUES ?";
		const parameters = [data];

		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Get hd accounts associated to a list of addresses
	 */
	async getUngroupedHDAccountsByAddresses(
		addresses: string[] = [],
	): Promise<DbRows> {
		if (addresses.length === 0) return [] as DbRows;

		const sqlQuery =
			"SELECT \
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
      AND `addresses`.`addrAddress` NOT IN (SELECT addrAddress FROM banned_addresses)";

		const parameters = [addresses];

		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Get HD accounts that own the input addresses
	 * If addresses are known but not associated with an HD account,
	 * theyare returned in the `loose` category
	 */
	async getHDAccountsByAddresses(addresses: string[] = []) {
		const returnValue: {
			hd: Record<
				string,
				{
					hdID: number;
					hdType: number;
					addresses: Array<{
						addrID: number;
						addrAddress: string;
						hdAddrChain: number;
						hdAddrIndex: number;
					}>;
				}
			>;
			loose: Array<{ addrID: number; addrAddress: string }>;
		} = {
			hd: {},
			loose: [],
		};

		if (addresses.length === 0) return returnValue;

		const sqlQuery =
			"SELECT \
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
      AND `addresses`.`addrAddress` NOT IN (SELECT addrAddress FROM banned_addresses)";

		const parameters = [addresses];
		const results = await this._query(sqlQuery, parameters);

		for (const r of results) {
			if (r.hdXpub == null) {
				returnValue.loose.push({
					addrID: r.addrID,
					addrAddress: r.addrAddress,
				});
			} else {
				if (!returnValue.hd[r.hdXpub]) {
					returnValue.hd[r.hdXpub] = {
						hdID: r.hdID,
						hdType: r.hdType,
						addresses: [],
					};
				}

				returnValue.hd[r.hdXpub].addresses.push({
					addrID: r.addrID,
					addrAddress: r.addrAddress,
					hdAddrChain: r.hdAddrChain,
					hdAddrIndex: r.hdAddrIndex,
				});
			}
		}

		return returnValue;
	}

	/**
	 * Get an HD account balance
	 */
	async getHDAccountBalance(xpub?: string) {
		const sqlQuery =
			"SELECT \
        SUM(`outputs`.`outAmount`) as balance \
      FROM `hd_addresses` \
      INNER JOIN `addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      INNER JOIN `outputs` ON `outputs`.`addrID` = `addresses`.`addrID`  \
      LEFT JOIN `inputs` ON `outputs`.`outID` = `inputs`.`outID` \
      WHERE `inputs`.`outID` IS NULL \
        AND `hd`.`hdXpub` = ?";

		const results = await this._query(sqlQuery, [xpub], true);

		if (results.length === 1)
			return results[0].balance == null ? 0 : results[0].balance;

		return null;
	}

	/**
	 * Get next unused address indices for each HD chain of an account
	 */
	async getHDAccountNextUnusedIndices(xpub?: string) {
		const sqlQuery =
			"SELECT \
        `hd_addresses`.`hdAddrChain`, \
        MAX(`hd_addresses`.`hdAddrIndex`) + 1 AS `nextUnusedIndex` \
      FROM `hd_addresses` \
      INNER JOIN `addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      INNER JOIN `outputs` ON `outputs`.`addrID` = `addresses`.`addrID`  \
      WHERE `hd`.`hdXpub` = ? \
      GROUP BY `hd_addresses`.`hdAddrChain`";

		const results = await this._query(sqlQuery, [xpub], true);

		const returnValue = [0, 0];

		for (const r of results)
			if ([0, 1].includes(r.hdAddrChain))
				returnValue[r.hdAddrChain] = r.nextUnusedIndex;

		return returnValue;
	}

	/**
	 * Get the maximum derived address index for each HD chain of an account
	 */
	async getHDAccountDerivedIndices(xpub?: string) {
		const sqlQuery =
			"SELECT \
        `hd_addresses`.`hdAddrChain`, \
        MAX(`hd_addresses`.`hdAddrIndex`) AS `maxDerivedIndex` \
      FROM `hd_addresses` \
      INNER JOIN `addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `hd`.`hdXpub` = ? \
      GROUP BY `hd_addresses`.`hdAddrChain`";

		const results = await this._query(sqlQuery, [xpub], true);

		const returnValue = [-1, -1];

		for (const r of results)
			if ([0, 1].includes(r.hdAddrChain))
				returnValue[r.hdAddrChain] = r.maxDerivedIndex;

		return returnValue;
	}

	/**
	 * Get the number of indices derived in an interval for a HD chain
	 */
	async getHDAccountNbDerivedIndices(
		xpub?: string,
		chain?: number,
		minIdx?: number,
		maxIdx?: number,
	) {
		const sqlQuery =
			"SELECT \
        COUNT(`hd_addresses`.`hdAddrIndex`) AS `nbDerivedIndices` \
      FROM `hd_addresses` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `hd`.`hdXpub` = ? \
      AND `hd_addresses`.`hdAddrChain` = ? \
      AND `hd_addresses`.`hdAddrIndex` >= ? \
      AND `hd_addresses`.`hdAddrIndex` <= ?";

		const parameters = [xpub, chain, minIdx, maxIdx];
		const results = await this._query(sqlQuery, parameters, true);

		if (results.length === 1) {
			const nbDerivedIndices = results[0].nbDerivedIndices;
			return nbDerivedIndices == null ? 0 : nbDerivedIndices;
		}

		return 0;
	}

	/**
	 * Get the number of transactions for an HD account
	 */
	async getHDAccountNbTransactions(xpub?: string) {
		const sqlQuery =
			"SELECT COUNT(DISTINCT `r`.`txnTxid`) AS nbTxs \
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
      ) AS `r`";

		const parameters = [xpub, xpub];
		const results = await this._query(sqlQuery, parameters, true);

		if (results.length === 1)
			return results[0].nbTxs == null ? 0 : results[0].nbTxs;

		return null;
	}

	/**
	 * Get the number of transactions for a list of addresses and HD accounts
	 */
	async getAddrAndXpubsNbTransactions(
		addresses: string[] = [],
		xpubs: string[] = [],
	): Promise<number | null | DbRows> {
		if (
			(!addresses || addresses.length === 0) &&
			(!xpubs || xpubs.length === 0)
		) {
			return [] as DbRows;
		}

		// Prepares subqueries for the query
		// retrieving txs of interest
		let subQuery = "";
		const subQueries: string[] = [];

		if (addresses && addresses.length > 0) {
			const parameters = [addresses, addresses];
			subQuery = mysql.format(SUBQUERY_TXIDS_ADDR, parameters);
			subQueries.push(subQuery);
		}

		if (xpubs && xpubs.length > 0) {
			const parameters = [xpubs, xpubs];
			subQuery = mysql.format(SUBQUERY_TXIDS_XPUBS, parameters);
			subQueries.push(subQuery);
		}

		subQuery = subQueries.join(" UNION ");

		const sqlQuery =
			"SELECT COUNT(DISTINCT `r`.`txnTxid`) AS nbTxs \
      FROM (" +
			subQuery +
			") AS `r`";

		const results = await this._query(sqlQuery);

		if (results.length === 1)
			return results[0].nbTxs == null ? 0 : results[0].nbTxs;

		return null;
	}

	/**
	 * Get the transactions for a list of addresses and HD accounts
	 */
	async getTxsByAddrAndXpubs(
		addresses: string[] = [],
		xpubs: string[] = [],
		page?: number,
		nbTxsPerPage?: number,
	) {
		if (
			(!addresses || addresses.length === 0) &&
			(!xpubs || xpubs.length === 0)
		) {
			return [];
		}

		// Manages the paging
		if (page == null) page = 0;

		if (nbTxsPerPage == null) nbTxsPerPage = keys.multiaddr.transactions;

		const skip = page * nbTxsPerPage;

		// Prepares subqueries for the query
		// retrieving txs of interest
		let subQuery = "";
		const subQueries: string[] = [];

		if (addresses && addresses.length > 0) {
			const parameters = [addresses, addresses];
			subQuery = mysql.format(SUBQUERY_TXS_ADDR, parameters);
			subQueries.push(subQuery);
		}

		if (xpubs && xpubs.length > 0) {
			const parameters = [xpubs, xpubs];
			subQuery = mysql.format(SUBQUERY_TXS_XPUB, parameters);
			subQueries.push(subQuery);
		}

		subQuery = subQueries.join(" UNION DISTINCT ");

		// Get a page of transactions
		const sqlQuery =
			"SELECT \
        `txs`.`txnID`, \
        `txs`.`txnTxid`, \
        `txs`.`txnVersion`, \
        `txs`.`txnLocktime`, \
        `txs`.`blockHeight`, \
        `txs`.`time` \
      FROM (" +
			subQuery +
			") AS txs \
      ORDER BY `txs`.`time` DESC, `txs`.`txnID` DESC \
      LIMIT ?,?";
		const parameters = [skip, nbTxsPerPage];
		const txs = await this._query(sqlQuery, parameters);

		const txsIds = txs.map((t) => t.txnID);

		if (txsIds.length === 0) return [];

		// Prepares subqueries for
		// the query retrieving utxos of interest
		let subQuery2 = "";
		const subQueries2: string[] = [];

		if (addresses && addresses.length > 0) {
			const parameters2 = [txsIds, addresses, txsIds, addresses];
			subQuery2 = mysql.format(SUBQUERY_UTXOS_ADDR, parameters2);
			subQueries2.push(subQuery2);
		}

		if (xpubs && xpubs.length > 0) {
			const parameters2 = [txsIds, xpubs, txsIds, xpubs];
			subQuery2 = mysql.format(SUBQUERY_UTXOS_XPUB, parameters2);
			subQueries2.push(subQuery2);
		}

		subQuery2 = subQueries2.join(" UNION DISTINCT ");

		// Get inputs and outputs of interest
		const sqlQuery2 =
			"SELECT * \
      FROM (" +
			subQuery2 +
			") AS `utxos` \
      ORDER BY `utxos`.`outIndex` ASC, `utxos`.`inIndex` ASC";

		const utxos = await this._query(sqlQuery2);

		return this.assembleTransactions(txs, utxos);
	}

	/**
	 * Initialize a transaction object returned as response to queries
	 */
	_transactionStub(tx: DbRow): ApiTransaction {
		const returnValue: ApiTransaction = {
			hash: tx.txnTxid,
			time: tx.time < 32503680000 ? tx.time : 0,
			version: tx.txnVersion,
			locktime: tx.txnLocktime,
			result: 0,
			inputs: [],
			out: [],
		};

		if (tx.blockHeight != null) returnValue.block_height = tx.blockHeight;

		return returnValue;
	}

	/**
	 * Initialize an input object returned as part of a response
	 */
	_inputStub(input: DbRow): ApiInput {
		const returnValue: ApiInput = {
			vin: input.inIndex,
			sequence: input.inSequence,
			prev_out: {
				txid: input.inOutTxid,
				vout: input.inOutIndex,
				value: input.inOutAmount,
				addr: input.inOutAddress,
			},
		};

		if (input.hdXpub) {
			returnValue.prev_out.xpub = {
				m: input.hdXpub,
				path: ["M", input.hdAddrChain, input.hdAddrIndex].join("/"),
			};
		}

		return returnValue;
	}

	/**
	 * Initialize an output object returned as part of a response
	 */
	_outputStub(output: DbRow): ApiOutput {
		const returnValue: ApiOutput = {
			n: output.outIndex,
			value: output.outAmount,
			addr: output.outAddress,
		};

		if (output.hdXpub) {
			returnValue.xpub = {
				m: output.hdXpub,
				path: ["M", output.hdAddrChain, output.hdAddrIndex].join("/"),
			};
		}

		return returnValue;
	}

	/**
	 * Take query results for txs and utxos and combine into transaction data
	 */
	assembleTransactions(txs: DbRows = [], utxos: DbRows = []) {
		const txns: Record<number, ApiTransaction> = {};

		for (const tx of txs) {
			if (!txns[tx.txnID]) txns[tx.txnID] = this._transactionStub(tx);
		}

		for (const u of utxos) {
			if (u.txnID != null && txns[u.txnID]) {
				if (u.inIndex != null) {
					const txn = txns[u.txnID];
					txn.result = (txn.result ?? 0) - u.inOutAmount;
					txn.inputs.push(this._inputStub(u));
				} else if (u.outIndex != null) {
					const txn = txns[u.txnID];
					txn.result = (txn.result ?? 0) + u.outAmount;
					txn.out.push(this._outputStub(u));
				}
			}
		}

		// Return transactions in descending time order, most recent first
		const returnValue = Object.keys(txns).map((key) => txns[Number(key)]);
		returnValue.sort((a, b) => b.time - a.time);
		return returnValue;
	}

	/**
	 * Get a list of unspent outputs for given hd account
	 */
	async getHDAccountUnspentOutputs(xpub?: string) {
		const sqlQuery =
			"SELECT \
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
        AND `hd`.`hdXpub` = ?";

		return await this._query(sqlQuery, [xpub], true);
	}

	/**
	 * Get addresses that belong to a given hd account
	 */
	async getXpubByAddresses(addresses: string[] = []) {
		const returnValue: Record<string, string> = {};

		if (addresses.length === 0) return returnValue;

		const sqlQuery =
			"SELECT `hd`.`hdXpub`, `addresses`.`addrAddress` \
      FROM `addresses` \
      INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `addresses`.`addrAddress` IN (?)";

		const parameters = [addresses];
		const results = await this._query(sqlQuery, parameters);

		for (const r of results) returnValue[r.addrAddress] = r.hdXpub;

		return returnValue;
	}

	/**
	 * Get the mysql ID of a transaction. Ensures that the transaction exists.
	 */
	async ensureTransactionId(txid?: string) {
		const sqlQuery = "INSERT IGNORE INTO `transactions` SET ?";
		const parameters = {
			txnTxid: txid,
			txnCreated: util.unix(),
		};
		const result = await this._query(sqlQuery, parameters);

		// Successful insertion
		if (result.insertId > 0) return result.insertId;

		// Transaction already in db
		const sqlQuery2 = "SELECT `txnID` FROM `transactions` WHERE `txnTxid` = ?";
		const result2 = await this._query(sqlQuery2, [txid], true);

		if (result2.length > 0) return result2[0].txnID;

		throw "Problem met while trying to insert a new transaction";
	}

	/**
	 * Get the mysql ID of a transaction
	 */
	async getTransactionId(txid?: string) {
		const sqlQuery = "SELECT `txnID` FROM `transactions` WHERE `txnTxid` = ?";
		const result = await this._query(sqlQuery, [txid], true);
		return result.length === 0 ? null : result[0].txnID;
	}

	/**
	 * Get the mysql IDs of a collection of transactions
	 */
	async getTransactionsIds(txids: string[] = []) {
		if (txids.length === 0) return {};

		const sqlQuery =
			"SELECT `txnID`, `txnTxid` FROM `transactions` WHERE `txnTxid` IN (?)";
		const parameters = [txids];
		const results = await this._query(sqlQuery, parameters);

		const returnValue: Record<string, number> = {};
		for (const r of results) returnValue[r.txnTxid] = r.txnID;
		return returnValue;
	}

	/**
	 * Get the mysql IDs of a set of transactions
	 */
	async getTransactionsById(txnIDs: number[] = []): Promise<DbRows> {
		if (txnIDs.length === 0) return [] as DbRows;

		const sqlQuery = "SELECT * FROM `transactions` WHERE `txnID` IN (?)";
		const parameters = [txnIDs];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Insert a new transaction in db
	 */
	async addTransaction(tx: NewTransaction) {
		if (!tx.created) tx.created = util.unix();

		const sqlQuery =
			"INSERT INTO `transactions` \
      (txnTxid, txnCreated, txnVersion, txnLocktime) VALUES (?) \
      ON DUPLICATE KEY UPDATE txnVersion = VALUES(txnVersion)";

		const parameters = [[tx.txid, tx.created, tx.version, tx.locktime]];

		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Insert a collection of transactions in db
	 */
	async addTransactions(txs: NewTransaction[] = []) {
		if (txs.length === 0) return;

		const sqlQuery =
			"INSERT INTO `transactions` \
      (txnTxid, txnCreated, txnVersion, txnLocktime) VALUES ? \
      ON DUPLICATE KEY UPDATE txnVersion = VALUES(txnVersion)";

		const parameters = [
			txs.map((tx): DbScalar[] => [
				tx.txid,
				tx.created || util.unix(),
				tx.version,
				tx.locktime,
			]),
		];

		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Get a transaction for a given txid
	 */
	async getTransaction(txid?: string) {
		const results = await Promise.all([
			this._query(SUBQUERY_GET_TX_OUTS, [txid], true),
			this._query(SUBQUERY_GET_TX_INS, [txid], true),
		]);

		const tx: ApiTransaction = {
			hash: txid,
			time: Number.POSITIVE_INFINITY,
			version: 0,
			locktime: 0,
			inputs: [],
			out: [],
			block_height: null,
		};

		// Process the outputs
		for (const output of results[0]) {
			tx.version = output.txnVersion;
			tx.locktime = output.txnLocktime;

			if (output.blockTime != null)
				tx.time = Math.min(tx.time, output.blockTime);

			tx.time = Math.min(tx.time, output.txnCreated);

			if (output.blockHeight != null) tx.block_height = output.blockHeight;

			const fmt: ApiOutput = {
				n: output.outIndex,
				value: output.outAmount,
				addr: output.addrAddress,
				script: output.outScript,
			};

			if (output.hdXpub) {
				fmt.xpub = {
					m: output.hdXpub,
					path: ["M", output.hdAddrChain, output.hdAddrIndex].join("/"),
				};
			}

			tx.out.push(fmt);
		}

		// Process the inputs
		for (const input of results[1]) {
			tx.version = input.txnVersion;
			tx.locktime = input.txnLocktime;

			if (input.blockTime != null) tx.time = Math.min(tx.time, input.blockTime);

			tx.time = Math.min(tx.time, input.txnCreated);

			if (input.blockHeight != null) tx.block_height = input.blockHeight;

			const fmt: ApiInput = {
				vin: input.inIndex,
				prev_out: {
					txid: input.prevOutTxid,
					vout: input.outIndex,
					value: input.outAmount,
					addr: input.addrAddress,
					script: input.outScript,
				},
				sequence: input.inSequence,
			};

			if (input.hdXpub) {
				fmt.prev_out.xpub = {
					m: input.hdXpub,
					path: ["M", input.hdAddrChain, input.hdAddrIndex].join("/"),
				};
			}

			tx.inputs.push(fmt);
		}

		// Remove block height if null
		if (tx.block_height == null) delete tx.block_height;

		return tx;
	}

	/**
	 * Get the unconfirmed transactions
	 */
	async getUnconfirmedTransactions() {
		const query = "SELECT * FROM `transactions` WHERE blockID IS NULL";
		return await this._query(query);
	}

	/**
	 * Get all transactions
	 */
	async getTransactions() {
		const query = "SELECT * FROM `transactions`";
		return await this._query(query);
	}

	/**
	 * Get the inputs of a transaction
	 */
	async getTxInputs(txnID?: number) {
		const sqlQuery = "SELECT * FROM `inputs` WHERE `txnID` = ?";
		return await this._query(sqlQuery, [txnID], true);
	}

	/**
	 * Batch confirm txids in a block
	 */
	async confirmTransactions(txnTxidArray: string[] = [], blockID?: number) {
		if (txnTxidArray.length === 0) return;

		const sqlQuery =
			"UPDATE `transactions` SET `blockID` = ? WHERE `txnTxid` IN (?)";
		const parameters = [blockID, txnTxidArray];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Get the transactions confirmed after a given height
	 */
	async getTransactionsConfirmedAfterHeight(height?: number) {
		const sqlQuery =
			"SELECT `transactions`.* FROM `transactions` \
      INNER JOIN `blocks` ON `blocks`.`blockID` = `transactions`.`blockID` \
      WHERE `blocks`.`blockHeight` > ?";
		return await this._query(sqlQuery, [height], true);
	}

	/**
	 * Delete the transactions confirmed after a given height
	 */
	async deleteTransactionsConfirmedAfterHeight(height?: number) {
		const sqlQuery =
			"DELETE `transactions`.* FROM `transactions` \
      INNER JOIN `blocks` ON `blocks`.`blockID` = `transactions`.`blockID` \
      WHERE `blocks`.`blockHeight` > ?";
		return await this._query(sqlQuery, [height]);
	}

	/**
	 * Batch unconfirm a set of transactions
	 */
	async unconfirmTransactions(txnTxidArray: string[] = []) {
		if (txnTxidArray.length === 0) return;

		const sqlQuery =
			"UPDATE `transactions` SET `blockID` = NULL WHERE `txnTxid` IN (?)";
		const parameters = [txnTxidArray];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Delete a transaction identified by its txid
	 */
	async deleteTransaction(txid?: string) {
		const sqlQuery =
			"DELETE `transactions`.* FROM `transactions` WHERE `transactions`.`txnTxid` = ?";
		return await this._query(sqlQuery, [txid]);
	}

	/**
	 * Delete a set of transactions identified by their mysql ids
	 */
	async deleteTransactionsByID(
		txnIDs: number[] = [],
	): Promise<DbRows | DbQueryResult> {
		if (txnIDs.length === 0) return [] as DbRows;

		const sqlQuery =
			"DELETE `transactions`.* FROM `transactions` WHERE `transactions`.`txnID` in (?)";
		const parameters = [txnIDs];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Insert transaction outputs associated with known addresses
	 */
	async addOutputs(outputs: NewOutput[] = []) {
		if (outputs.length === 0) return;

		const sqlQuery =
			"INSERT IGNORE INTO `outputs` \
      (txnID, addrID, outIndex, outAmount, outScript) VALUES ?";

		const parameters = [
			outputs.map((o): DbScalar[] => [
				o.txnID,
				o.addrID,
				o.outIndex,
				o.outAmount,
				o.outScript,
			]),
		];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Get a list of outputs identified by their txid and index.
	 * The presence of spendingTxnID and spendingInID not null indicate that an
	 * input spending the transaction output index is already in the database and
	 * may indicate a DOUBLE SPEND.
	 */
	async getOutputSpends(spends: OutputSpendRef[] = []): Promise<DbRows> {
		if (spends.length === 0) return [] as DbRows;
		if (this.pool == null) throw new Error("Database pool is not initialized");
		const pool = this.pool;

		const whereClauses = spends.map(
			(s) =>
				"(`txnTxid`=" +
				pool.escape(s.txid) +
				" AND `outIndex`=" +
				pool.escape(s.index) +
				")",
		);

		const whereClause = whereClauses.join(" OR ");

		const sqlQuery = `SELECT \
        \`addrAddress\`, \
        \`outputs\`.\`outID\`, \
        \`outAmount\`, \
        \`txnTxid\`, \
        \`outIndex\`, \
        \`inputs\`.\`txnID\` AS \`spendingTxnID\` \
      FROM \`outputs\` \
      INNER JOIN \`addresses\` ON \`outputs\`.\`addrID\` = \`addresses\`.\`addrID\` \
      INNER JOIN \`transactions\` ON \`outputs\`.\`txnID\` = \`transactions\`.\`txnID\` \
      LEFT JOIN \`inputs\` ON \`inputs\`.\`outID\` = \`outputs\`.outID \
      WHERE ${whereClause}`;

		return await this._query(sqlQuery);
	}

	/**
	 * Get a list of mysql ids for outputs identified by their txid and index.
	 */
	async getOutputIds(spends: OutputSpendRef[] = []): Promise<DbRows> {
		if (spends.length === 0) return [] as DbRows;
		if (this.pool == null) throw new Error("Database pool is not initialized");
		const pool = this.pool;

		const whereClauses = spends.map(
			(s) =>
				"(`txnTxid`=" +
				pool.escape(s.txid) +
				" AND `outIndex`=" +
				pool.escape(s.vout) +
				")",
		);

		const whereClause = whereClauses.join(" OR ");

		const sqlQuery = `SELECT \
        \`outID\`, \
        \`txnTxid\`, \
        \`outIndex\` \
      FROM \`outputs\` \
      INNER JOIN \`transactions\` ON \`outputs\`.\`txnID\` = \`transactions\`.\`txnID\` \
      WHERE ${whereClause}`;

		return await this._query(sqlQuery);
	}

	/**
	 * Get a list of unspent outputs for a list of addresses
	 */
	async getUnspentOutputs(addresses: string[] = []): Promise<DbRows> {
		if (addresses.length === 0) return [] as DbRows;

		const sqlQuery =
			"SELECT \
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
        AND (`addrAddress`) IN (?)";

		const parameters = [addresses];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Insert transaction inputs that spend known Outputs
	 */
	async addInputs(inputs: NewInput[] = []) {
		if (inputs.length === 0) return;

		const sqlQuery =
			"INSERT INTO `inputs` \
      (txnID, outID, inIndex, inSequence) VALUES ? \
      ON DUPLICATE KEY UPDATE outID = VALUES(outID)";

		const parameters = [
			inputs.map((input): DbScalar[] => [
				input.txnID,
				input.outID,
				input.inIndex,
				input.inSequence,
			]),
		];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Insert a new block
	 */
	async addBlock(block: NewBlock) {
		const sqlQuery = "INSERT IGNORE INTO `blocks` SET ?";
		const result = await this._query(sqlQuery, block);

		// Successful insertion
		if (result.insertId > 0) return result.insertId;

		// Block already in db
		const sqlQuery2 = "SELECT `blockID` FROM `blocks` WHERE `blockHash` = ?";
		const parameters2 = [block.blockHash];
		const result2 = await this._query(sqlQuery2, parameters2);

		if (result2.length > 0) return result2[0].blockID;

		throw "Problem met while trying to insert a new block";
	}

	/**
	 * Get a block identified by the block hash
	 */
	async getBlockByHash(hash?: string) {
		const sqlQuery = "SELECT * FROM `blocks` WHERE `blockHash` = ?";
		const result = await this._query(sqlQuery, [hash], true);
		return result.length === 1 ? result[0] : null;
	}

	/**
	 * Get a collection of blocks identified by the blocks hashes
	 */
	async getBlocksByHashes(hashes: string[] = []): Promise<DbRows> {
		if (hashes.length === 0) return [] as DbRows;

		const sqlQuery = "SELECT * FROM `blocks` WHERE `blockHash` IN (?)";
		const parameters = [hashes];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Get details about all blocks at a given block height
	 */
	async getBlocksByHeight(height?: number) {
		const sqlQuery = "SELECT * FROM `blocks` WHERE `blockHeight` = ?";
		return await this._query(sqlQuery, [height], true);
	}

	/**
	 * Delete the blocks after a given block height
	 */
	async deleteBlocksAfterHeight(height?: number) {
		const sqlQuery = "DELETE FROM `blocks` WHERE `blockHeight` > ?";
		return await this._query(sqlQuery, [height]);
	}

	/**
	 * Gets the last block
	 */
	async getHighestBlock() {
		try {
			const results = await this.getLastBlocks(1);
			return results == null || results.length === 0
				? {
						blockID: null as number | null,
						blockHeight: 0,
					}
				: results[0];
		} catch (error) {
			Logger.error(
				error,
				"Db Wrapper : getHighestBlock() : Failed to get highest block from the DB",
			);
			return {
				blockID: null,
				blockHeight: 0,
			};
		}
	}

	/**
	 * Gets the N last blocks
	 */
	async getLastBlocks(n?: number) {
		const sqlQuery =
			"SELECT * FROM `blocks` ORDER BY `blockHeight` DESC LIMIT ?";
		return await this._query(sqlQuery, n);
	}

	/**
	 * Get all scheduled transactions
	 */
	async getScheduledTransactions() {
		const sqlQuery =
			"SELECT * FROM `scheduled_transactions` ORDER BY `schTrigger`, `schCreated`";
		return await this._query(sqlQuery);
	}

	/**
	 * Get the mysql ID of a scheduled transaction
	 */
	async getScheduledTransactionId(txid?: string) {
		const sqlQuery =
			"SELECT `schID` FROM `scheduled_transactions` WHERE `schTxid` = ?";
		const result = await this._query(sqlQuery, [txid], true);
		return result.length === 0 ? null : result[0].txnID;
	}

	/**
	 * Insert a new scheduled transaction in db
	 */
	async addScheduledTransaction(tx: NewScheduledTransaction) {
		if (!tx.created) tx.created = util.unix();

		const sqlQuery =
			"INSERT INTO `scheduled_transactions` \
      (schTxid, schCreated, schRaw, schParentID, schParentTxid, schDelay, schTrigger) VALUES (?)";

		const parameters = [
			[
				tx.txid,
				tx.created,
				tx.rawTx,
				tx.parentId,
				tx.parentTxid,
				tx.delay,
				tx.trigger,
			],
		];

		const result = await this._query(sqlQuery, parameters);

		if (result.insertId > 0) return result.insertId;

		throw "Problem met while trying to insert a new scheduled transaction";
	}

	/**
	 * Delete a scheduled transaction
	 */
	async deleteScheduledTransaction(txid?: string) {
		const sqlQuery =
			"DELETE `scheduled_transactions`.* \
      FROM `scheduled_transactions` \
      WHERE `scheduled_transactions`.`schTxid` = ?";
		return await this._query(sqlQuery, [txid]);
	}

	/**
	 * Get scheduled transactions
	 * with a trigger lower than a given block height
	 */
	async getActivatedScheduledTransactions(height?: number) {
		const sqlQuery =
			"SELECT * FROM `scheduled_transactions` \
      WHERE `schTrigger` <= ? AND `schParentID` IS NULL";
		return await this._query(sqlQuery, [height], true);
	}

	/**
	 * Get the scheduled transaction having a given parentID
	 */
	async getNextScheduledTransactions(parentId?: number) {
		const sqlQuery =
			"SELECT * FROM `scheduled_transactions` \
      WHERE `schParentID` = ?";
		return await this._query(sqlQuery, [parentId], true);
	}

	/**
	 * Update the trigger of a scheduled transaction
	 * identified by its ID
	 */
	async updateTriggerScheduledTransaction(id?: number, trigger?: number) {
		const sqlQuery =
			"UPDATE `scheduled_transactions` \
      SET `schTrigger` = ? \
      WHERE `schID` = ?";
		const parameters = [trigger, id];
		return await this._query(sqlQuery, parameters);
	}

	/**
	 * Get one API key
	 */
	async getApiKeyID(apikey?: string) {
		const sqlQuery = "SELECT `apikeyID` FROM `api_keys` WHERE `apikey` = ?";
		const result = await this._query(sqlQuery, [apikey], true);
		return result.length === 0 ? null : result[0].apikeyID;
	}

	/**
	 * Get all API keys
	 */
	async getApiKeys() {
		const sqlQuery = "SELECT * FROM `api_keys`";
		const results = await this._query(sqlQuery, true);

		return results.map((row) => ({
			...row,
			active: Boolean(row.active),
		}));
	}

	/**
	 * Get active API keys
	 */
	async getActiveApiKeys(): Promise<DbRows> {
		const sqlQuery =
			"SELECT * \
                                 FROM `api_keys` \
                                 WHERE `active` = TRUE \
                                 AND `expiresAt` > CURRENT_TIMESTAMP";
		return await this._query(sqlQuery, true);
	}

	/**
	 * Create a new API key
	 */
	async createApiKey(label?: string, apikey?: string, expiresAt?: Date) {
		const sqlQuery =
			"INSERT INTO `api_keys` (label, apikey, expiresAt) VALUES (?, ?, ?)";

		return await this._query(sqlQuery, [label, apikey, expiresAt]);
	}

	/**
	 * Create a new API key
	 */
	async updateApiKey(
		apikeyID?: number,
		label?: string,
		active?: boolean,
		expiresAt?: Date,
	) {
		const sqlQuery =
			"UPDATE `api_keys` SET label = ?, active = ?, expiresAt = ? WHERE apikeyID = ?";

		return await this._query(sqlQuery, [label, active, expiresAt, apikeyID]);
	}

	/**
	 * Delete API key
	 */
	async deleteApiKey(apikey?: string) {
		const sqlQuery = "DELETE FROM `api_keys` WHERE `apikey` = ?";
		return await this._query(sqlQuery, [apikey]);
	}

	/**
	 * MAINTENANCE FUNCTIONS
	 */

	async getInvalidAccountTimes() {
		const sqlQuery =
			"SELECT \
        `hd`.`hdID`, \
        `hdCreated`, \
        min(`txnCreated`) as `earliest` \
      FROM `hd` \
      INNER JOIN `hd_addresses` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      INNER JOIN `addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `outputs` ON `outputs`.`addrID` = `hd_addresses`.`addrID` \
      INNER JOIN `transactions` ON `outputs`.`txnID` = `transactions`.`txnID` \
      WHERE `hd`.`hdCreated` > `transactions`.`txnCreated` \
      GROUP BY `hd`.`hdID` LIMIT 100";

		return await this._query(sqlQuery);
	}

	async getInvalidTxTimes() {
		const sqlQuery =
			"SELECT \
        `txnID`, \
        `txnCreated`, \
        `blockTime` \
      FROM `transactions` \
      INNER JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
      WHERE `transactions`.`txnCreated` > `blocks`.`blockTime` \
      LIMIT 100";

		return await this._query(sqlQuery);
	}

	async setHDTime(hdID: number, hdCreated: number) {
		const sqlQuery = "UPDATE `hd` SET `hdCreated` = ? WHERE `hdID` = ?";
		const parameters = [hdCreated, hdID];
		return await this._query(sqlQuery, parameters);
	}

	async setTransactionTime(txnID: number, txnCreated: number) {
		const sqlQuery =
			"UPDATE `transactions` SET `txnCreated` = ? WHERE `txnID` = ?";
		const parameters = [txnCreated, txnID];
		return await this._query(sqlQuery, parameters);
	}

	async updateInputSequence(inID: number, inSequence: number) {
		const sqlQuery = "UPDATE `inputs` SET `inSequence` = ? WHERE `inID` = ?";
		const parameters = [inSequence, inID];
		return await this._query(sqlQuery, parameters);
	}

	async getOutputsWithoutScript() {
		const sqlQuery =
			"SELECT \
        `txnTxid`, \
        `outIndex`, \
        `outId` \
      FROM `outputs` \
      INNER JOIN `transactions` ON `outputs`.`txnID` = `transactions`.`txnID` \
      WHERE length(`outputs`.`outScript`) = 0 \
      ORDER BY `outId` \
      LIMIT 100";

		return await this._query(sqlQuery);
	}

	async updateOutputScript(outID: number, outScript: string) {
		const sqlQuery = "UPDATE `outputs` SET `outScript` = ? WHERE `outID` = ?";
		const parameters = [outScript, outID];
		return await this._query(sqlQuery, parameters);
	}

	async setBlockParent(hash?: string, blockID?: number) {
		const sqlQuery =
			"UPDATE `blocks` SET `blockParent` = ? WHERE `blockHash` = ?";
		const parameters = [blockID, hash];
		return await this._query(sqlQuery, parameters);
	}
}

export default new MySqlDbWrapper();

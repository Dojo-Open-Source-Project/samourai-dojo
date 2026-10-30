/*!
 * lib/db.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import mariadb, {
	type Pool,
	type PoolConfig,
	type PoolConnection,
} from "mariadb";
import { format, type SqlValue } from "sql-escaper";
import keysFile from "../../keys/index.js";
import hdaHelper from "../bitcoin/hd-accounts-helper.js";
import network from "../bitcoin/network.js";
import errors from "../errors.js";
import Logger from "../logger.js";
import util from "../util.js";
import type {
	AddressOwnershipRow,
	AddressRow,
	ApiKeyRow,
	BlockRow,
	DbWriteResult,
	HdAccountRow,
	HdUnspentOutputRow,
	InputRow,
	OutputIdRow,
	OutputSpendRow,
	ScheduledTransactionRow,
	TransactionInputRow,
	TransactionOutputRow,
	TransactionPageRow,
	TransactionRow,
	TransactionUtxoRow,
	UnspentOutputRow,
} from "./mysql-db-types.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;
const debug = process.argv.includes("db-debug");
const queryDebug = process.argv.includes("dbquery-debug");
const MAX_INSERT_BATCH_BYTES = 1024 * 1024;
const MAX_PREPARED_PARAMETERS = 65535;
const MAX_OUTPOINT_BATCH_ROWS = 1000;
const MAX_OUTPOINT_BATCH_BYTES = 1024 * 1024;

/**
 * Transaction ID subqueries used by counts and transaction history.
 */
const SUBQUERY_TXIDS_ADDR =
	"( \
  SELECT `outputs`.`txnID` AS txnID \
  FROM `outputs` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  WHERE `addresses`.`addrAddress` IN (?) \
) UNION ( \
  SELECT `inputs`.`txnID` AS txnID \
  FROM `inputs` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  WHERE `addresses`.`addrAddress` IN (?) \
)";

const SUBQUERY_TXIDS_XPUBS =
	"( \
  SELECT `outputs`.`txnID` AS txnID \
  FROM `outputs` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  WHERE `hd`.`hdXpub` IN (?) \
) UNION ( \
  SELECT `inputs`.`txnID` AS txnID \
  FROM `inputs` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  WHERE `hd`.`hdXpub` IN (?) \
)";

// Keep the address joins from transaction history when selecting HD matches.
const SUBQUERY_HISTORY_TXIDS_XPUB =
	"(\
  SELECT `outputs`.`txnID` AS `txnID` \
  FROM `outputs` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
  WHERE `hd`.`hdXpub` IN (?) \
) UNION DISTINCT (\
  SELECT `inputs`.`txnID` AS `txnID` \
  FROM `inputs` \
  INNER JOIN `outputs` ON `outputs`.`outID` = `inputs`.`outID` \
  INNER JOIN `addresses` ON `addresses`.`addrID` = `outputs`.`addrID` \
  INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
  INNER JOIN `hd` ON `hd`.`hdID` = `hd_addresses`.`hdID` \
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

const defaultConfig: PoolConfig = {
	// Keep numeric results and metadata consistent with the existing wrapper API.
	decimalAsNumber: true,
	bigIntAsNumber: true,
	insertIdAsNumber: true,
	metaAsArray: true,
	collation: "UTF8MB4_UNICODE_CI",
	connectTimeout: 10000,
	minimumIdle: 0,
	namedPlaceholders: true,
};

type DbScalar = string | number | boolean | Date | Buffer | null | undefined;
type DbQueryValues = unknown;
type SqlFormatValues =
	| SqlValue
	| SqlValue[]
	| SqlValue[][]
	| Record<string, SqlValue | SqlValue[]>;
type DbConfig = PoolConfig & {
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

const isLockError = (error: unknown) =>
	hasMysqlCode(error) &&
	["ER_LOCK_DEADLOCK", "ER_LOCK_TIMEOUT", "ER_LOCK_WAIT_TIMEOUT"].includes(
		error.code,
	);

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

interface InsertIdentity {
	query: string;
	keyIndexes: number[];
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
 * Connector doc: https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api
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
		this.dbConfig = null;
		// Db connections pool
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
	async disconnect() {
		if (this.pool) {
			try {
				await this.pool.end();
			} catch (error) {
				Logger.error(error, "DB Wrapper : Error when disconnecting from DB");
			} finally {
				this.pool = null;
			}
		}
	}

	/**
	 * Connect the wrapper to the mysql server
	 */
	handleConnect() {
		try {
			if (this.dbConfig == null) throw new Error("Database config is missing");
			this.pool = mariadb.createPool(this.dbConfig);
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
			void this.pool
				.end()
				.then(() => this.handleConnect())
				.catch((error: unknown) => {
					Logger.error(
						error,
						"Db Wrapper : handleReconnect() : Problem met while terminating the pool",
					);
					this.timerReconnect = setTimeout(() => this.handleReconnect(), 2000);
				})
				.finally(() => {
					this.lockReconnect = false;
				});
		}
	}

	/**
	 * Send a query with its selected row array or write metadata type.
	 * Untyped queries return unknown, so callers must declare the result shape.
	 */
	async _query<T = unknown>(
		query: string,
		values?: DbQueryValues,
		usePrepare = false,
		retries = 5,
	): Promise<T> {
		const sqlValues = values as SqlFormatValues;
		queryDebug && Logger.info(`Db Wrapper : ${format(query, sqlValues)}`);

		if (this.pool == null) throw new Error("Database pool is not initialized");
		try {
			const [result] = usePrepare
				? await this.pool.execute<[T, unknown[]]>(
						{
							sql: query,
							// Unlike mysql2, MariaDB applies named conversion to arrays too.
							namedPlaceholders:
								this.dbConfig?.namedPlaceholders && !Array.isArray(sqlValues),
						},
						sqlValues,
					)
				: await this.pool.query<[T, unknown[]]>(format(query, sqlValues));

			queryDebug && Logger.info(`Db Wrapper : ${JSON.stringify(result)}`);

			return result;
		} catch (error) {
			// Retry the request on lock errors
			if (isLockError(error) && retries > 0) {
				this.queryError(
					new Error("Lock detected. Retry request in a few ms"),
					format(query, sqlValues),
				);
				await util.delay(Math.floor(Math.random() * 100 + 1));
				return await this._query<T>(query, values, usePrepare, retries - 1);
			}

			this.queryError(error, format(query, sqlValues));
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

	/** Consume SELECT rows without retaining an intermediate result array. */
	private async _queryReduce<T, Row extends object>(
		query: string,
		values: DbQueryValues,
		createResult: () => T,
		consumeRow: (result: T, row: Row) => void,
		retries = 5,
	): Promise<T> {
		const sql = format(query, values as SqlFormatValues);
		queryDebug && Logger.info(`Db Wrapper : ${sql}`);
		if (this.pool == null) throw new Error("Database pool is not initialized");
		try {
			const connection = await this.pool.getConnection();
			try {
				// Each attempt owns its accumulator so a retry discards partial results.
				const result = createResult();
				const stream = connection.queryStream({
					sql,
					namedPlaceholders: false,
				}) as ReturnType<typeof connection.queryStream> & { close(): void };
				try {
					await new Promise<void>((resolve, reject) => {
						let failed = false;
						stream.on("data", (row: Row) => {
							if (failed) return;
							try {
								consumeRow(result, row);
								queryDebug &&
									Logger.info(`Db Wrapper : ${JSON.stringify(row)}`);
							} catch (error) {
								failed = true;
								reject(error);
							}
						});
						stream.once("error", (error: unknown) => {
							failed = true;
							reject(error);
						});
						stream.once("end", resolve);
					});
					return result;
				} finally {
					// MariaDB's close() resumes a paused socket and drains unread rows.
					stream.close();
				}
			} finally {
				await connection.release();
			}
		} catch (error) {
			if (isLockError(error) && retries > 0) {
				this.queryError(
					new Error("Lock detected. Retry request in a few ms"),
					sql,
				);
				await util.delay(Math.floor(Math.random() * 100 + 1));
				return this._queryReduce(
					query,
					values,
					createResult,
					consumeRow,
					retries - 1,
				);
			}
			this.queryError(error, sql);
			throw error;
		}
	}

	private _insertStatement(query: string, rows: DbScalar[][]) {
		const tuple = `(${rows[0].map(() => "?").join(",")})`;
		return {
			sql: query.replace(
				"VALUES ?",
				`VALUES ${rows.map(() => tuple).join(",")}`,
			),
			values: rows.flat(),
		};
	}

	/** Bound both parameter count and encoded bytes, keeping the call atomic. */
	private _insertMany(
		query: string,
		rows: DbScalar[][],
		identity?: InsertIdentity,
	) {
		const byteLimit = Math.max(
			1,
			Math.min(
				MAX_INSERT_BATCH_BYTES,
				(this.dbConfig?.maxAllowedPacket ?? Infinity) - 1024,
			),
		);
		const baseBytes = Buffer.byteLength(query) + 32;
		const maxRows = Math.floor(MAX_PREPARED_PARAMETERS / rows[0].length);
		const chunks: DbScalar[][][] = [];
		let start = 0;
		let bytes = baseBytes;
		for (let index = 0; index < rows.length; index++) {
			// Include type tags, null bitmap, length prefixes, and SQL placeholders.
			const rowBytes = rows[index].reduce<number>(
				(total, value) =>
					total +
					(typeof value === "string"
						? Buffer.byteLength(value) + 16
						: Buffer.isBuffer(value)
							? value.length + 16
							: value instanceof Date
								? 32
								: 16),
				4,
			);
			if (
				index > start &&
				(bytes + rowBytes > byteLimit || index - start >= maxRows)
			) {
				chunks.push(rows.slice(start, index));
				start = index;
				bytes = baseBytes;
			}
			bytes += rowBytes;
		}
		chunks.push(rows.slice(start));
		if (chunks.length === 1) {
			const statement = this._insertStatement(query, chunks[0]);
			return this._query<DbWriteResult>(statement.sql, statement.values, true);
		}
		return this._insertChunks(query, chunks, identity);
	}

	private async _lastInsertId(connection: PoolConnection): Promise<number> {
		const [rows] = await connection.query<[{ insertId: number }[], unknown[]]>(
			"SELECT LAST_INSERT_ID() AS insertId",
		);
		return Number(rows[0].insertId);
	}

	private async _insertChunks(
		query: string,
		chunks: DbScalar[][][],
		identity?: InsertIdentity,
		retries = 5,
	): Promise<DbWriteResult> {
		if (this.pool == null) throw new Error("Database pool is not initialized");
		try {
			const connection = await this.pool.getConnection();
			try {
				await connection.beginTransaction();
				const aggregate: DbWriteResult = {
					insertId: 0,
					affectedRows: 0,
					warningStatus: 0,
				};
				const upsert = identity != null;
				const previousId = upsert ? await this._lastInsertId(connection) : 0;
				let firstGeneratedId = 0;
				for (const rows of chunks) {
					// An upsert's OK packet can contain an updated row's ID. The session
					// value distinguishes that from the first newly generated ID.
					if (upsert) await connection.query("DO LAST_INSERT_ID(0)");
					const statement = this._insertStatement(query, rows);
					queryDebug &&
						Logger.info(
							`Db Wrapper : ${format(statement.sql, statement.values)}`,
						);
					const [result] = await connection.execute<[DbWriteResult, unknown[]]>(
						{ sql: statement.sql, namedPlaceholders: false, metaAsArray: true },
						statement.values,
					);
					aggregate.affectedRows += result.affectedRows ?? 0;
					aggregate.warningStatus = Math.min(
						65535,
						aggregate.warningStatus + (result.warningStatus ?? 0),
					);
					const generatedId = upsert
						? await this._lastInsertId(connection)
						: (result.affectedRows ?? 0) > 0
							? result.insertId
							: 0;
					if (!firstGeneratedId && generatedId) firstGeneratedId = generatedId;
				}
				aggregate.insertId = firstGeneratedId;
				const rowCount = chunks.reduce((count, rows) => count + rows.length, 0);
				const changedExisting =
					(this.dbConfig?.foundRows ?? true)
						? aggregate.affectedRows > rowCount
						: aggregate.affectedRows > 0;
				if (identity && !firstGeneratedId && changedExisting) {
					// With updates but no inserts, one multi-row INSERT reports the last
					// row's ID, including when that final row itself was unchanged.
					const lastRows = chunks[chunks.length - 1];
					const lastRow = lastRows[lastRows.length - 1];
					const [ids] = await connection.execute<
						[{ insertId: number }[], unknown[]]
					>(
						{
							sql: identity.query,
							namedPlaceholders: false,
							metaAsArray: true,
						},
						identity.keyIndexes.map((index) => lastRow[index]),
					);
					aggregate.insertId = ids[0].insertId;
				}
				if (upsert || firstGeneratedId) {
					await connection.query(
						{ sql: "DO LAST_INSERT_ID(?)", namedPlaceholders: false },
						[firstGeneratedId || previousId],
					);
				}
				await connection.commit();
				return aggregate;
			} catch (error) {
				try {
					await connection.rollback();
				} catch (rollbackError) {
					Logger.error(
						rollbackError,
						"Db Wrapper : Failed to roll back insert batches",
					);
				}
				throw error;
			} finally {
				await connection.release();
			}
		} catch (error) {
			this.queryError(error, query);
			if (isLockError(error) && retries > 0) {
				await util.delay(Math.floor(Math.random() * 100 + 1));
				return this._insertChunks(query, chunks, identity, retries - 1);
			}
			throw error;
		}
	}

	/**
	 * Get the ID of an address
	 */
	async getAddressId(address?: string) {
		const sqlQuery = "SELECT `addrID` FROM `addresses` WHERE `addrAddress` = ?";
		const result = await this._query<Pick<AddressRow, "addrID">[]>(
			sqlQuery,
			[address],
			true,
		);

		if (result.length > 0) return result[0].addrID;

		throw errors.db.ERROR_NO_ADDRESS;
	}

	/**
	 * Get the ID of an Address. Ensures that the address exists.
	 */
	async ensureAddressId(address?: string) {
		const sqlQuery = "SELECT `addrID` FROM `addresses` WHERE `addrAddress` = ?";
		const result = await this._query<Pick<AddressRow, "addrID">[]>(
			sqlQuery,
			[address],
			true,
		);

		if (result.length > 0) return result[0].addrID;

		const sqlQuery2 = "INSERT INTO `addresses` SET ?";
		const parameters2 = { addrAddress: address };
		const result2 = await this._query<DbWriteResult>(sqlQuery2, parameters2);
		return result2.insertId;
	}

	/**
	 * Get the IDs of an array of Addresses
	 */
	async getAddressesIds(addresses: string[] = []) {
		if (addresses.length === 0) return {} as Record<string, number>;

		const sqlQuery = "SELECT * FROM `addresses` WHERE `addrAddress` IN (?)";
		const parameters = [addresses];
		return this._queryReduce(
			sqlQuery,
			parameters,
			(): Record<string, number> => ({}),
			(result, row: AddressRow) => {
				result[row.addrAddress] = row.addrID;
			},
		);
	}

	/**
	 * Bulk insert addresses.
	 */
	async addAddresses(addresses: string[] = []): Promise<[] | DbWriteResult> {
		if (addresses.length === 0) return [] as [];

		const sqlQuery = "INSERT IGNORE INTO `addresses` (addrAddress) VALUES ?";
		const rows = addresses.map((address): DbScalar[] => [address]);
		return this._insertMany(sqlQuery, rows);
	}

	/**
	 * Bulk select address entries
	 */
	async getAddresses(addresses: string[] = []): Promise<AddressRow[]> {
		if (addresses.length === 0) return [] as [];

		const sqlQuery = "SELECT * FROM `addresses` WHERE `addrAddress` IN (?)";
		const parameters = [addresses];
		return await this._query<AddressRow[]>(sqlQuery, parameters);
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

		const results = await this._query<{ balance: number | null }[]>(
			sqlQuery,
			[address],
			true,
		);

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
		return this._countTransactions([address], []);
	}

	/**
	 * Get an HD account.
	 */
	async getHDAccount(xpub?: string) {
		const sqlQuery = "SELECT * FROM `hd` WHERE `hdXpub` = ?";
		const result = await this._query<HdAccountRow[]>(sqlQuery, [xpub], true);

		if (result.length > 0) return result[0];

		throw errors.db.ERROR_NO_HD_ACCOUNT;
	}

	/**
	 * Get the ID of an HD account
	 */
	async getHDAccountId(xpub?: string) {
		const sqlQuery = "SELECT `hdID` FROM `hd` WHERE `hdXpub` = ?";
		const result = await this._query<Pick<HdAccountRow, "hdID">[]>(
			sqlQuery,
			[xpub],
			true,
		);

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
		const result = await this._query<Pick<HdAccountRow, "hdID">[]>(
			sqlQuery,
			[xpub],
			true,
		);

		if (result.length > 0) return result[0].hdID;

		const sqlQuery2 = "INSERT INTO `hd` SET ?";
		const parameters2 = {
			hdXpub: xpub,
			hdCreated: util.unix(),
			hdType: type,
		};
		const result2 = await this._query<DbWriteResult>(sqlQuery2, parameters2);
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
		return await this._query<DbWriteResult>(sqlQuery, parameters);
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

			await this._query<DbWriteResult>(sqlQuery, [xpub]);

			// Delete HD account entry
			const sqlQuery2 = "DELETE FROM `hd` WHERE `hdXpub` = ?";

			return await this._query<DbWriteResult>(sqlQuery2, [xpub]);
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

		return await this._query<DbWriteResult>(sqlQuery, parameters);
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
		return this._insertMany(sqlQuery, data);
	}

	/**
	 * Get hd accounts associated to a list of addresses
	 */
	async getUngroupedHDAccountsByAddresses(
		addresses: string[] = [],
	): Promise<AddressOwnershipRow[]> {
		if (addresses.length === 0) return [] as [];

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

		return await this._query<AddressOwnershipRow[]>(sqlQuery, parameters);
	}

	/**
	 * Get HD accounts that own the input addresses
	 * If addresses are known but not associated with an HD account,
	 * theyare returned in the `loose` category
	 */
	async getHDAccountsByAddresses(addresses: string[] = []) {
		const createResult = (): {
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
		} => ({
			hd: {},
			loose: [],
		});

		if (addresses.length === 0) return createResult();

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
		return this._queryReduce(
			sqlQuery,
			parameters,
			createResult,
			(returnValue, r: AddressOwnershipRow) => {
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
			},
		);
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

		const results = await this._query<{ balance: number | null }[]>(
			sqlQuery,
			[xpub],
			true,
		);

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
      WHERE `hd`.`hdXpub` = ? \
        AND EXISTS (SELECT 1 FROM `outputs` WHERE `outputs`.`addrID` = `addresses`.`addrID`) \
      GROUP BY `hd_addresses`.`hdAddrChain`";

		const results = await this._query<
			{ hdAddrChain: number; nextUnusedIndex: number | null }[]
		>(sqlQuery, [xpub], true);

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

		const results = await this._query<
			{ hdAddrChain: number; maxDerivedIndex: number | null }[]
		>(sqlQuery, [xpub], true);

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
		const results = await this._query<{ nbDerivedIndices: number }[]>(
			sqlQuery,
			parameters,
			true,
		);

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
		return this._countTransactions([], [xpub]);
	}

	/**
	 * Get the number of transactions for a list of addresses and HD accounts
	 */
	async getAddrAndXpubsNbTransactions(
		addresses: string[] = [],
		xpubs: string[] = [],
	): Promise<number | null | []> {
		if (
			(!addresses || addresses.length === 0) &&
			(!xpubs || xpubs.length === 0)
		) {
			return [] as [];
		}

		return this._countTransactions(addresses, xpubs);
	}

	private async _countTransactions(addresses: string[], xpubs: string[]) {
		// Prepares subqueries for the query
		// retrieving txs of interest
		let subQuery = "";
		const subQueries: string[] = [];

		if (addresses && addresses.length > 0) {
			const parameters = [addresses, addresses];
			subQuery = format(SUBQUERY_TXIDS_ADDR, parameters);
			subQueries.push(subQuery);
		}

		if (xpubs && xpubs.length > 0) {
			const parameters = [xpubs, xpubs];
			subQuery = format(SUBQUERY_TXIDS_XPUBS, parameters);
			subQueries.push(subQuery);
		}

		subQuery = subQueries.join(" UNION ");

		const sqlQuery =
			"SELECT COUNT(*) AS nbTxs \
      FROM (" +
			subQuery +
			") AS `r` INNER JOIN `transactions` ON `transactions`.`txnID` = `r`.`txnID` \
      WHERE `transactions`.`txnTxid` IS NOT NULL";

		const results = await this._query<{ nbTxs: number }[]>(sqlQuery);

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
			subQuery = format(SUBQUERY_TXIDS_ADDR, parameters);
			subQueries.push(subQuery);
		}

		if (xpubs && xpubs.length > 0) {
			const parameters = [xpubs, xpubs];
			subQuery = format(SUBQUERY_HISTORY_TXIDS_XPUB, parameters);
			subQueries.push(subQuery);
		}

		subQuery = subQueries.join(" UNION DISTINCT ");

		// Deduplicate IDs before joining transaction details and applying pagination.
		const sqlQuery =
			"SELECT \
        `transactions`.`txnID`, \
        `transactions`.`txnTxid`, \
        `transactions`.`txnVersion`, \
        `transactions`.`txnLocktime`, \
        `blocks`.`blockHeight`, \
        LEAST(`transactions`.`txnCreated`, IFNULL(`blocks`.`blockTime`, 32503680000)) AS `time` \
      FROM (" +
			subQuery +
			") AS txs \
      INNER JOIN `transactions` ON `transactions`.`txnID` = `txs`.`txnID` \
      LEFT JOIN `blocks` ON `transactions`.`blockID` = `blocks`.`blockID` \
      ORDER BY `time` DESC, `transactions`.`txnID` DESC \
      LIMIT ?,?";
		const parameters = [skip, nbTxsPerPage];
		const txs = await this._query<TransactionPageRow[]>(sqlQuery, parameters);

		const txsIds = txs.map((t) => t.txnID);

		if (txsIds.length === 0) return [];

		// Prepares subqueries for
		// the query retrieving utxos of interest
		let subQuery2 = "";
		const subQueries2: string[] = [];

		if (addresses && addresses.length > 0) {
			const parameters2 = [txsIds, addresses, txsIds, addresses];
			subQuery2 = format(SUBQUERY_UTXOS_ADDR, parameters2);
			subQueries2.push(subQuery2);
		}

		if (xpubs && xpubs.length > 0) {
			const parameters2 = [txsIds, xpubs, txsIds, xpubs];
			subQuery2 = format(SUBQUERY_UTXOS_XPUB, parameters2);
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

		const assembler = await this._queryReduce(
			sqlQuery2,
			undefined,
			() => this._transactionAssembler(txs),
			(result, row: TransactionUtxoRow) => result.addRow(row),
		);
		return assembler.finish();
	}

	/**
	 * Initialize a transaction object returned as response to queries
	 */
	_transactionStub(tx: TransactionPageRow): ApiTransaction {
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
	_inputStub(input: TransactionUtxoRow): ApiInput {
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
	_outputStub(output: TransactionUtxoRow): ApiOutput {
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
	assembleTransactions(
		txs: TransactionPageRow[] = [],
		utxos: TransactionUtxoRow[] = [],
	) {
		const assembler = this._transactionAssembler(txs);
		for (const row of utxos) assembler.addRow(row);
		return assembler.finish();
	}

	private _transactionAssembler(txs: TransactionPageRow[]) {
		const txns = new Map<number, ApiTransaction>();

		for (const tx of txs) {
			if (!txns.has(tx.txnID)) txns.set(tx.txnID, this._transactionStub(tx));
		}

		const addRow = (u: TransactionUtxoRow) => {
			const txn = txns.get(u.txnID);
			if (u.txnID != null && txn) {
				if (u.inIndex != null) {
					txn.result = (txn.result ?? 0) - u.inOutAmount;
					txn.inputs.push(this._inputStub(u));
				} else if (u.outIndex != null) {
					txn.result = (txn.result ?? 0) + u.outAmount;
					txn.out.push(this._outputStub(u));
				}
			}
		};

		// Return transactions in descending time order, most recent first
		const finish = () => {
			const result = [...txns.values()];
			result.sort((a, b) => b.time - a.time);
			return result;
		};
		return { addRow, finish };
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

		return await this._query<HdUnspentOutputRow[]>(sqlQuery, [xpub], true);
	}

	/**
	 * Get addresses that belong to a given hd account
	 */
	async getXpubByAddresses(addresses: string[] = []) {
		if (addresses.length === 0) return {} as Record<string, string>;

		const sqlQuery =
			"SELECT `hd`.`hdXpub`, `addresses`.`addrAddress` \
      FROM `addresses` \
      INNER JOIN `hd_addresses` ON `hd_addresses`.`addrID` = `addresses`.`addrID` \
      INNER JOIN `hd` ON `hd_addresses`.`hdID` = `hd`.`hdID` \
      WHERE `addresses`.`addrAddress` IN (?)";

		const parameters = [addresses];
		return this._queryReduce(
			sqlQuery,
			parameters,
			(): Record<string, string> => ({}),
			(result, row: { hdXpub: string | null; addrAddress: string | null }) => {
				result[row.addrAddress] = row.hdXpub;
			},
		);
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
		const result = await this._query<DbWriteResult>(sqlQuery, parameters);

		// Successful insertion
		if (result.insertId > 0) return result.insertId;

		// Transaction already in db
		const sqlQuery2 = "SELECT `txnID` FROM `transactions` WHERE `txnTxid` = ?";
		const result2 = await this._query<Pick<TransactionRow, "txnID">[]>(
			sqlQuery2,
			[txid],
			true,
		);

		if (result2.length > 0) return result2[0].txnID;

		throw "Problem met while trying to insert a new transaction";
	}

	/**
	 * Get the mysql ID of a transaction
	 */
	async getTransactionId(txid?: string) {
		const sqlQuery = "SELECT `txnID` FROM `transactions` WHERE `txnTxid` = ?";
		const result = await this._query<Pick<TransactionRow, "txnID">[]>(
			sqlQuery,
			[txid],
			true,
		);
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
		return this._queryReduce(
			sqlQuery,
			parameters,
			(): Record<string, number> => ({}),
			(result, row: Pick<TransactionRow, "txnID" | "txnTxid">) => {
				result[row.txnTxid] = row.txnID;
			},
		);
	}

	/**
	 * Get the mysql IDs of a set of transactions
	 */
	async getTransactionsById(txnIDs: number[] = []): Promise<TransactionRow[]> {
		if (txnIDs.length === 0) return [] as [];

		const sqlQuery = "SELECT * FROM `transactions` WHERE `txnID` IN (?)";
		const parameters = [txnIDs];
		return await this._query<TransactionRow[]>(sqlQuery, parameters);
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

		return await this._query<DbWriteResult>(sqlQuery, parameters);
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

		const rows = txs.map((tx): DbScalar[] => [
			tx.txid,
			tx.created || util.unix(),
			tx.version,
			tx.locktime,
		]);

		return this._insertMany(sqlQuery, rows, {
			query: "SELECT txnID AS insertId FROM transactions WHERE txnTxid = ?",
			keyIndexes: [0],
		});
	}

	/**
	 * Get a transaction for a given txid
	 */
	async getTransaction(txid?: string) {
		const createTransaction = (): ApiTransaction => ({
			hash: txid,
			time: Number.POSITIVE_INFINITY,
			version: 0,
			locktime: 0,
			inputs: [],
			out: [],
			block_height: null,
		});

		const [tx, inputTx] = await Promise.all([
			this._queryReduce(
				SUBQUERY_GET_TX_OUTS,
				[txid],
				createTransaction,
				(tx, output: TransactionOutputRow) => {
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
				},
			),
			this._queryReduce(
				SUBQUERY_GET_TX_INS,
				[txid],
				createTransaction,
				(tx, input: TransactionInputRow) => {
					tx.version = input.txnVersion;
					tx.locktime = input.txnLocktime;

					if (input.blockTime != null)
						tx.time = Math.min(tx.time, input.blockTime);

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
				},
			),
		]);

		tx.inputs = inputTx.inputs;
		tx.time = Math.min(tx.time, inputTx.time);
		if (inputTx.inputs.length > 0) {
			tx.version = inputTx.version;
			tx.locktime = inputTx.locktime;
		}
		if (inputTx.block_height != null) tx.block_height = inputTx.block_height;
		if (tx.block_height == null) delete tx.block_height;
		return tx;
	}

	/**
	 * Get the unconfirmed transactions
	 */
	async getUnconfirmedTransactions() {
		const query = "SELECT * FROM `transactions` WHERE blockID IS NULL";
		return await this._query<TransactionRow[]>(query);
	}

	getUnconfirmedTransactionIds(): Promise<string[]> {
		return this._queryReduce(
			"SELECT `txnTxid` FROM `transactions` WHERE `blockID` IS NULL",
			undefined,
			(): string[] => [],
			(ids, row: Pick<TransactionRow, "txnTxid">) => {
				ids.push(row.txnTxid);
			},
		);
	}

	/**
	 * Get all transactions
	 */
	async getTransactions() {
		const query = "SELECT * FROM `transactions`";
		return await this._query<TransactionRow[]>(query);
	}

	/**
	 * Get the inputs of a transaction
	 */
	async getTxInputs(txnID?: number) {
		const sqlQuery = "SELECT * FROM `inputs` WHERE `txnID` = ?";
		return await this._query<InputRow[]>(sqlQuery, [txnID], true);
	}

	/**
	 * Batch confirm txids in a block
	 */
	async confirmTransactions(txnTxidArray: string[] = [], blockID?: number) {
		if (txnTxidArray.length === 0) return;

		const sqlQuery =
			"UPDATE `transactions` SET `blockID` = ? WHERE `txnTxid` IN (?)";
		const parameters = [blockID, txnTxidArray];
		return await this._query<DbWriteResult>(sqlQuery, parameters);
	}

	/**
	 * Get the transactions confirmed after a given height
	 */
	async getTransactionsConfirmedAfterHeight(height?: number) {
		const sqlQuery =
			"SELECT `transactions`.* FROM `transactions` \
      INNER JOIN `blocks` ON `blocks`.`blockID` = `transactions`.`blockID` \
      WHERE `blocks`.`blockHeight` > ?";
		return await this._query<TransactionRow[]>(sqlQuery, [height], true);
	}

	getTransactionIdsConfirmedAfterHeight(height: number): Promise<string[]> {
		return this._queryReduce(
			"SELECT transactions.txnTxid FROM transactions INNER JOIN blocks ON blocks.blockID = transactions.blockID WHERE blocks.blockHeight > ?",
			[height],
			(): string[] => [],
			(ids, row: Pick<TransactionRow, "txnTxid">) => {
				ids.push(row.txnTxid);
			},
		);
	}

	/**
	 * Delete the transactions confirmed after a given height
	 */
	async deleteTransactionsConfirmedAfterHeight(height?: number) {
		const sqlQuery =
			"DELETE `transactions`.* FROM `transactions` \
      INNER JOIN `blocks` ON `blocks`.`blockID` = `transactions`.`blockID` \
      WHERE `blocks`.`blockHeight` > ?";
		return await this._query<DbWriteResult>(sqlQuery, [height]);
	}

	/**
	 * Batch unconfirm a set of transactions
	 */
	async unconfirmTransactions(txnTxidArray: string[] = []) {
		if (txnTxidArray.length === 0) return;

		const sqlQuery =
			"UPDATE `transactions` SET `blockID` = NULL WHERE `txnTxid` IN (?)";
		const parameters = [txnTxidArray];
		return await this._query<DbWriteResult>(sqlQuery, parameters);
	}

	/**
	 * Delete a transaction identified by its txid
	 */
	async deleteTransaction(txid?: string) {
		const sqlQuery =
			"DELETE `transactions`.* FROM `transactions` WHERE `transactions`.`txnTxid` = ?";
		return await this._query<DbWriteResult>(sqlQuery, [txid]);
	}

	/**
	 * Delete a set of transactions identified by their mysql ids
	 */
	async deleteTransactionsByID(
		txnIDs: number[] = [],
	): Promise<[] | DbWriteResult> {
		if (txnIDs.length === 0) return [] as [];

		const sqlQuery =
			"DELETE `transactions`.* FROM `transactions` WHERE `transactions`.`txnID` in (?)";
		const parameters = [txnIDs];
		return await this._query<DbWriteResult>(sqlQuery, parameters);
	}

	/**
	 * Insert transaction outputs associated with known addresses
	 */
	async addOutputs(outputs: NewOutput[] = []) {
		if (outputs.length === 0) return;

		const sqlQuery =
			"INSERT IGNORE INTO `outputs` \
      (txnID, addrID, outIndex, outAmount, outScript) VALUES ?";

		const rows = outputs.map((o): DbScalar[] => [
			o.txnID,
			o.addrID,
			o.outIndex,
			o.outAmount,
			o.outScript,
		]);
		return this._insertMany(sqlQuery, rows);
	}

	/** Build a deduplicated request set for indexed outpoint joins. */
	private _outpointRequests(
		spends: OutputSpendRef[],
		indexKey: "index" | "vout",
	) {
		const sql = spends
			.map((_, index) =>
				index === 0 ? "SELECT ? AS txnTxid, ? AS outIndex" : "SELECT ?, ?",
			)
			.join(" UNION ");
		const values = spends.flatMap((spend) => [spend.txid, spend[indexKey]]);
		return { sql, values };
	}

	/** Keep each request bounded; multiple batches share one read snapshot. */
	private async _queryOutpoints<Row extends { outID: number }>(
		spends: OutputSpendRef[],
		indexKey: "index" | "vout",
		buildQuery: (requested: string, batched: boolean) => string,
	): Promise<Row[]> {
		if (spends.length === 0) return [];
		const byteLimit = Math.max(
			1,
			Math.min(
				MAX_OUTPOINT_BATCH_BYTES,
				(this.dbConfig?.maxAllowedPacket ?? Infinity) - 1024,
			),
		);
		const baseBytes = Buffer.byteLength(buildQuery("", true)) + 128;
		const chunks: OutputSpendRef[][] = [];
		let start = 0;
		let bytes = baseBytes;
		for (let index = 0; index < spends.length; index++) {
			// Budget UNION SQL, placeholders, parameter types and encoded values.
			const rowBytes = Buffer.byteLength(spends[index].txid) + 96;
			if (
				index > start &&
				(index - start >= MAX_OUTPOINT_BATCH_ROWS ||
					bytes + rowBytes > byteLimit)
			) {
				chunks.push(spends.slice(start, index));
				start = index;
				bytes = baseBytes;
			}
			bytes += rowBytes;
		}
		chunks.push(spends.slice(start));
		if (chunks.length === 1) {
			const requested = this._outpointRequests(chunks[0], indexKey);
			return this._query<Row[]>(
				buildQuery(requested.sql, false),
				requested.values,
				true,
			);
		}
		return this._queryOutpointChunks<Row>(chunks, indexKey, buildQuery);
	}

	private async _queryOutpointChunks<Row extends { outID: number }>(
		chunks: OutputSpendRef[][],
		indexKey: "index" | "vout",
		buildQuery: (requested: string, batched: boolean) => string,
		retries = 5,
	): Promise<Row[]> {
		if (this.pool == null) throw new Error("Database pool is not initialized");
		try {
			const connection = await this.pool.getConnection();
			try {
				// SET TRANSACTION applies to this transaction only, leaving pool defaults intact.
				await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
				await connection.query(
					"START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
				);
				const result: Row[] = [];
				const seen = new Set<string>();
				for (const chunk of chunks) {
					const requested = this._outpointRequests(chunk, indexKey);
					const sql = buildQuery(requested.sql, true);
					queryDebug &&
						Logger.info(`Db Wrapper : ${format(sql, requested.values)}`);
					const [rows] = await connection.execute<
						[(Row & { _outpointInputId?: number | null })[], unknown[]]
					>(
						{ sql, namedPlaceholders: false, metaAsArray: true },
						requested.values,
					);
					for (const row of rows) {
						// Deduplicate database identities, respecting case-insensitive matches.
						// Input IDs preserve multiple spending inputs with identical public fields.
						const key = `${row.outID}:${row._outpointInputId ?? ""}`;
						delete row._outpointInputId;
						if (!seen.has(key)) {
							seen.add(key);
							result.push(row);
						}
					}
				}
				await connection.commit();
				queryDebug && Logger.info(`Db Wrapper : ${JSON.stringify(result)}`);
				return result;
			} catch (error) {
				try {
					await connection.rollback();
				} catch (rollbackError) {
					Logger.error(
						rollbackError,
						"Db Wrapper : Failed to roll back outpoint batches",
					);
				}
				throw error;
			} finally {
				await connection.release();
			}
		} catch (error) {
			this.queryError(error, "Batched outpoint lookup");
			if (isLockError(error) && retries > 0) {
				await util.delay(Math.floor(Math.random() * 100 + 1));
				return this._queryOutpointChunks<Row>(
					chunks,
					indexKey,
					buildQuery,
					retries - 1,
				);
			}
			throw error;
		}
	}

	/** Fetch known outputs and any transaction currently spending each output. */
	async getOutputSpends(
		spends: OutputSpendRef[] = [],
	): Promise<OutputSpendRow[]> {
		return this._queryOutpoints<OutputSpendRow>(
			spends,
			"index",
			(requested, batched) => `SELECT
			addresses.addrAddress, outputs.outID, outputs.outAmount,
			transactions.txnTxid, outputs.outIndex,
			inputs.txnID AS spendingTxnID
			${batched ? ", inputs.inID AS _outpointInputId" : ""}
			FROM (${requested}) AS requested
			INNER JOIN transactions ON transactions.txnTxid = requested.txnTxid
			INNER JOIN outputs ON outputs.txnID = transactions.txnID AND outputs.outIndex = requested.outIndex
			INNER JOIN addresses ON addresses.addrID = outputs.addrID
			LEFT JOIN inputs ON inputs.outID = outputs.outID`,
		);
	}

	/** Get output IDs for a set of outpoints. UNION deduplicates requests. */
	async getOutputIds(spends: OutputSpendRef[] = []): Promise<OutputIdRow[]> {
		return this._queryOutpoints<OutputIdRow>(
			spends,
			"vout",
			(requested) => `SELECT outputs.outID, transactions.txnTxid, outputs.outIndex
			FROM (${requested}) AS requested
			INNER JOIN transactions ON transactions.txnTxid = requested.txnTxid
			INNER JOIN outputs ON outputs.txnID = transactions.txnID AND outputs.outIndex = requested.outIndex`,
		);
	}

	/**
	 * Get a list of unspent outputs for a list of addresses
	 */
	async getUnspentOutputs(
		addresses: string[] = [],
	): Promise<UnspentOutputRow[]> {
		if (addresses.length === 0) return [] as [];

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
		return await this._query<UnspentOutputRow[]>(sqlQuery, parameters);
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

		const rows = inputs.map((input): DbScalar[] => [
			input.txnID,
			input.outID,
			input.inIndex,
			input.inSequence,
		]);
		return this._insertMany(sqlQuery, rows, {
			query:
				"SELECT inID AS insertId FROM inputs WHERE txnID = ? AND inIndex = ?",
			keyIndexes: [0, 2],
		});
	}

	/**
	 * Insert a new block
	 */
	async addBlock(block: NewBlock) {
		const sqlQuery = "INSERT IGNORE INTO `blocks` SET ?";
		const result = await this._query<DbWriteResult>(sqlQuery, block);

		// Successful insertion
		if (result.insertId > 0) return result.insertId;

		// Block already in db
		const sqlQuery2 = "SELECT `blockID` FROM `blocks` WHERE `blockHash` = ?";
		const parameters2 = [block.blockHash];
		const result2 = await this._query<Pick<BlockRow, "blockID">[]>(
			sqlQuery2,
			parameters2,
		);

		if (result2.length > 0) return result2[0].blockID;

		throw "Problem met while trying to insert a new block";
	}

	/**
	 * Get a block identified by the block hash
	 */
	async getBlockByHash(hash?: string) {
		const sqlQuery = "SELECT * FROM `blocks` WHERE `blockHash` = ?";
		const result = await this._query<BlockRow[]>(sqlQuery, [hash], true);
		return result.length === 1 ? result[0] : null;
	}

	/**
	 * Get a collection of blocks identified by the blocks hashes
	 */
	async getBlocksByHashes(hashes: string[] = []): Promise<BlockRow[]> {
		if (hashes.length === 0) return [] as [];

		const sqlQuery = "SELECT * FROM `blocks` WHERE `blockHash` IN (?)";
		const parameters = [hashes];
		return await this._query<BlockRow[]>(sqlQuery, parameters);
	}

	/**
	 * Get details about all blocks at a given block height
	 */
	async getBlocksByHeight(height?: number) {
		const sqlQuery = "SELECT * FROM `blocks` WHERE `blockHeight` = ?";
		return await this._query<BlockRow[]>(sqlQuery, [height], true);
	}

	/**
	 * Delete the blocks after a given block height
	 */
	async deleteBlocksAfterHeight(height?: number) {
		const sqlQuery = "DELETE FROM `blocks` WHERE `blockHeight` > ?";
		return await this._query<DbWriteResult>(sqlQuery, [height]);
	}

	/**
	 * Gets the last block
	 */
	async getHighestBlock() {
		const results = await this.getLastBlocks(1);
		return results.length === 0
			? { blockID: null as number | null, blockHeight: 0 }
			: results[0];
	}

	/**
	 * Gets the N last blocks
	 */
	async getLastBlocks(n?: number) {
		const sqlQuery =
			"SELECT * FROM `blocks` ORDER BY `blockHeight` DESC LIMIT ?";
		return await this._query<BlockRow[]>(sqlQuery, n);
	}

	/**
	 * Get all scheduled transactions
	 */
	async getScheduledTransactions() {
		const sqlQuery =
			"SELECT * FROM `scheduled_transactions` ORDER BY `schTrigger`, `schCreated`";
		return await this._query<ScheduledTransactionRow[]>(sqlQuery);
	}

	/**
	 * Get the mysql ID of a scheduled transaction
	 */
	async getScheduledTransactionId(txid?: string) {
		const sqlQuery =
			"SELECT `schID` FROM `scheduled_transactions` WHERE `schTxid` = ?";
		const result = await this._query<Pick<ScheduledTransactionRow, "schID">[]>(
			sqlQuery,
			[txid],
			true,
		);
		return result.length === 0 ? null : result[0].schID;
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

		const result = await this._query<DbWriteResult>(sqlQuery, parameters);

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
		return await this._query<DbWriteResult>(sqlQuery, [txid]);
	}

	/**
	 * Get scheduled transactions
	 * with a trigger lower than a given block height
	 */
	async getActivatedScheduledTransactions(height?: number) {
		const sqlQuery =
			"SELECT * FROM `scheduled_transactions` \
      WHERE `schTrigger` <= ? AND `schParentID` IS NULL";
		return await this._query<ScheduledTransactionRow[]>(
			sqlQuery,
			[height],
			true,
		);
	}

	/**
	 * Get the scheduled transaction having a given parentID
	 */
	async getNextScheduledTransactions(parentId?: number) {
		const sqlQuery =
			"SELECT * FROM `scheduled_transactions` \
      WHERE `schParentID` = ?";
		return await this._query<ScheduledTransactionRow[]>(
			sqlQuery,
			[parentId],
			true,
		);
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
		return await this._query<DbWriteResult>(sqlQuery, parameters);
	}

	/**
	 * Get one API key
	 */
	async getApiKeyID(apikey?: string) {
		const sqlQuery = "SELECT `apikeyID` FROM `api_keys` WHERE `apikey` = ?";
		const result = await this._query<Pick<ApiKeyRow, "apikeyID">[]>(
			sqlQuery,
			[apikey],
			true,
		);
		return result.length === 0 ? null : result[0].apikeyID;
	}

	/**
	 * Get all API keys
	 */
	async getApiKeys() {
		const sqlQuery = "SELECT * FROM `api_keys`";
		const results = await this._query<ApiKeyRow[]>(sqlQuery, true);

		return results.map((row) => ({
			...row,
			active: Boolean(row.active),
		}));
	}

	/**
	 * Get active API keys
	 */
	async getActiveApiKeys(): Promise<ApiKeyRow[]> {
		const sqlQuery =
			"SELECT * \
                                 FROM `api_keys` \
                                 WHERE `active` = TRUE \
                                 AND `expiresAt` > CURRENT_TIMESTAMP";
		return await this._query<ApiKeyRow[]>(sqlQuery, true);
	}

	async isApiKeyActive(apiKey: unknown): Promise<boolean> {
		if (typeof apiKey !== "string" || apiKey.length === 0) return false;
		const rows = await this._query<Pick<ApiKeyRow, "apikey">[]>(
			"SELECT `apikey` FROM `api_keys` WHERE `apikey` = ? AND `active` = TRUE AND `expiresAt` > CURRENT_TIMESTAMP LIMIT 1",
			[apiKey],
			true,
		);
		// The SQL lookup uses the unique index; compare exactly because the
		// database collation may ignore case or trailing spaces.
		return rows.length === 1 && rows[0].apikey === apiKey;
	}

	/**
	 * Create a new API key
	 */
	async createApiKey(label?: string, apikey?: string, expiresAt?: Date) {
		const sqlQuery =
			"INSERT INTO `api_keys` (label, apikey, expiresAt) VALUES (?, ?, ?)";

		return await this._query<DbWriteResult>(sqlQuery, [
			label,
			apikey,
			expiresAt,
		]);
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

		return await this._query<DbWriteResult>(sqlQuery, [
			label,
			active,
			expiresAt,
			apikeyID,
		]);
	}

	/**
	 * Delete API key
	 */
	async deleteApiKey(apikey?: string) {
		const sqlQuery = "DELETE FROM `api_keys` WHERE `apikey` = ?";
		return await this._query<DbWriteResult>(sqlQuery, [apikey]);
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

		return await this._query<
			{ hdID: number; hdCreated: number; earliest: number | null }[]
		>(sqlQuery);
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

		return await this._query<
			{ txnID: number; txnCreated: number; blockTime: number }[]
		>(sqlQuery);
	}

	async setHDTime(hdID: number, hdCreated: number) {
		const sqlQuery = "UPDATE `hd` SET `hdCreated` = ? WHERE `hdID` = ?";
		const parameters = [hdCreated, hdID];
		return await this._query<DbWriteResult>(sqlQuery, parameters);
	}

	async setTransactionTime(txnID: number, txnCreated: number) {
		const sqlQuery =
			"UPDATE `transactions` SET `txnCreated` = ? WHERE `txnID` = ?";
		const parameters = [txnCreated, txnID];
		return await this._query<DbWriteResult>(sqlQuery, parameters);
	}

	async updateInputSequence(inID: number, inSequence: number) {
		const sqlQuery = "UPDATE `inputs` SET `inSequence` = ? WHERE `inID` = ?";
		const parameters = [inSequence, inID];
		return await this._query<DbWriteResult>(sqlQuery, parameters);
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

		return await this._query<
			{ txnTxid: string | null; outIndex: number; outId: number }[]
		>(sqlQuery);
	}

	async updateOutputScript(outID: number, outScript: string) {
		const sqlQuery = "UPDATE `outputs` SET `outScript` = ? WHERE `outID` = ?";
		const parameters = [outScript, outID];
		return await this._query<DbWriteResult>(sqlQuery, parameters);
	}

	async setBlockParent(hash?: string, blockID?: number) {
		const sqlQuery =
			"UPDATE `blocks` SET `blockParent` = ? WHERE `blockHash` = ?";
		const parameters = [blockID, hash];
		return await this._query<DbWriteResult>(sqlQuery, parameters);
	}
}

export default new MySqlDbWrapper();

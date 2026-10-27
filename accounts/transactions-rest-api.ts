/*!
 * accounts/transactions-fees-rest-api.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import validator from "validator";
import keysFile from "../keys/index.js";
import authMgr from "../lib/auth/authorizations-manager.js";
import network from "../lib/bitcoin/network.js";
import rpcTxns from "../lib/bitcoind-rpc/transactions.js";
import errors from "../lib/errors.js";
import HttpServer from "../lib/http-server/http-server.js";
import Logger from "../lib/logger.js";
import walletService from "../lib/wallet/wallet-service.js";
import apiHelper from "./api-helper.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;
const debugApi = process.argv.includes("api-debug");

/**
 * Transactions API endpoints
 */
class TransactionsRestApi {
	declare httpServer: HttpServer;
	/**
	 * Constructor
	 */
	constructor(httpServer: HttpServer) {
		this.httpServer = httpServer;

		// Establish routes
		this.httpServer.app.get(
			"/tx/:txid",
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsGetTransaction.bind(this),
			this.getTransaction.bind(this),
		);

		this.httpServer.app.get(
			"/tx/:txid/hex",
			authMgr.checkAuthentication.bind(authMgr),
			this.validateArgsGetTransactionHex.bind(this),
			this.getTransactionHex.bind(this),
		);

		this.httpServer.app.get(
			"/txs",
			authMgr.checkAuthentication.bind(authMgr),
			apiHelper.validateEntitiesParams.bind(apiHelper),
			this.validateArgsGetTransactions.bind(this),
			this.getTransactions.bind(this),
		);

		this.httpServer.app.get(
			"/txout/:txid/:index",
			authMgr.checkAuthentication.bind(authMgr),
			this.getTxOut.bind(this),
		);
	}

	/**
	 * Retrieve the transaction for a given txid
	 */
	async getTransaction(c: HttpContext) {
		try {
			const tx = await rpcTxns.getTransaction(c.req.param("txid"), {
				fees: c.req.query("fees") != null,
				rawHex: c.req.query("rawHex") != null,
			});
			const returnValue = JSON.stringify(tx, null, 2);
			HttpServer.sendRawData(c, returnValue);
		} catch (error) {
			HttpServer.sendError(c, error);
		} finally {
			const stringParameters = `${c.req.query("fees") || ""}`;
			debugApi &&
				Logger.info(
					`API : Completed GET /tx/${c.req.param("txid")} ${stringParameters}`,
				);
		}
	}

	/**
	 * Retrieve raw transaction for a given txid
	 */
	async getTransactionHex(c: HttpContext) {
		try {
			const rawTx = await rpcTxns.getTransactionHex(c.req.param("txid"));

			HttpServer.sendOkData(c, rawTx);
		} catch (error) {
			HttpServer.sendError(c, error);
		} finally {
			debugApi &&
				Logger.info(`API : Completed GET /tx/${c.req.param("txid")}/hex`);
		}
	}

	/**
	 * Retrieve a page of transactions related to a wallet
	 */
	async getTransactions(c: HttpContext) {
		try {
			// Check request params
			if (!apiHelper.checkEntitiesParams(c.req.query()))
				return HttpServer.sendError(c, errors.multiaddr.NOACT);

			// Parse params
			const active = apiHelper.parseEntities(c.req.query("active"));
			const page =
				c.req.query("page") == null
					? 0
					: Number.parseInt(c.req.query("page"), 10);
			const count =
				c.req.query("count") == null
					? keys.multiaddr.transactions
					: Number.parseInt(c.req.query("count"), 10);
			const excludeNullXfer = c.req.query("excludeNullXfer") != null;

			const result = await walletService.getWalletTransactions(
				active,
				page,
				count,
			);
			if (excludeNullXfer) {
				result.txs = result.txs.filter((tx) => {
					return tx.result !== 0;
				});
			}

			const returnValue = JSON.stringify(result, null, 2);
			HttpServer.sendRawData(c, returnValue);
		} catch (error) {
			HttpServer.sendError(c, error);
		} finally {
			const stringParameters = `${c.req.query("active")} \
        ${c.req.query("page") || ""} \
        ${c.req.query("count") || ""}`;

			debugApi && Logger.info(`API : Completed GET /txs ${stringParameters}`);
		}
	}

	/**
	 * Retrieve a utxo for a given txid and index
	 */
	async getTxOut(c: HttpContext) {
		if (!c.req.param("txid") || !c.req.param("index")) {
			return HttpServer.sendError(c, errors.params.INVALID);
		}

		const index = Number.parseInt(c.req.param("index"), 10);

		if (Number.isNaN(index)) {
			return HttpServer.sendError(c, errors.params.INVALID);
		}

		try {
			const txout = await rpcTxns.rpcClient.gettxout({
				txid: c.req.param("txid"),
				n: index,
			});

			HttpServer.sendOkDataOnly(c, txout);
		} catch {
			HttpServer.sendError(c, null, 404);
		}
	}

	/**
	 * Validate arguments of /tx requests
	 */
	async validateArgsGetTransaction(c: HttpContext, next: HttpNext) {
		const isValidTxid = validator.isHash(c.req.param("txid"), "sha256");

		const isValidFees =
			!c.req.query("fees") || validator.isAlphanumeric(c.req.query("fees"));

		if (isValidTxid && isValidFees) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				c.req.param(),
				"API : HeadersRestApi.validateArgsGetTransaction() : Invalid arguments",
			);
			Logger.error(c.req.query(), "");
		}
	}

	/**
	 * Validate arguments of /tx/:txid/hex requests
	 */
	async validateArgsGetTransactionHex(c: HttpContext, next: HttpNext) {
		const isValidTxid = validator.isHash(c.req.param("txid"), "sha256");

		if (isValidTxid) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				c.req.param(),
				"API : HeadersRestApi.validateArgsGetTransactionHex() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate arguments of /txs requests
	 */
	async validateArgsGetTransactions(c: HttpContext, next: HttpNext) {
		const isValidPage =
			!c.req.query("page") || validator.isInt(c.req.query("page"));

		const isValidCount =
			!c.req.query("count") || validator.isInt(c.req.query("count"));

		const isValidExcludeNull =
			!c.req.query("excludeNullXfer") ||
			validator.isAlphanumeric(c.req.query("excludeNullXfer"));

		if (isValidPage && isValidCount && isValidExcludeNull) {
			await next();
		} else {
			HttpServer.sendError(c, errors.body.INVDATA);
			Logger.error(
				c.req.query(),
				"API : HeadersRestApi.validateArgsGetTransactions() : Invalid arguments",
			);
		}
	}
}

export default TransactionsRestApi;

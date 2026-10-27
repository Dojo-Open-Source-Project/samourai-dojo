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
			"txout/:txid/:index",
			authMgr.checkAuthentication.bind(authMgr),
			this.getTxOut.bind(this),
		);
	}

	/**
	 * Retrieve the transaction for a given txid
	 */
	async getTransaction(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			const tx = await rpcTxns.getTransaction(req.params.txid, {
				fees: req.query.fees != null,
				rawHex: req.query.rawHex != null,
			});
			const returnValue = JSON.stringify(tx, null, 2);
			HttpServer.sendRawData(res, returnValue);
		} catch (error) {
			HttpServer.sendError(res, error);
		} finally {
			const stringParameters = `${req.query.fees || ""}`;
			debugApi &&
				Logger.info(
					`API : Completed GET /tx/${req.params.txid} ${stringParameters}`,
				);
		}
	}

	/**
	 * Retrieve raw transaction for a given txid
	 */
	async getTransactionHex(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			const rawTx = await rpcTxns.getTransactionHex(req.params.txid);

			HttpServer.sendOkData(res, rawTx);
		} catch (error) {
			HttpServer.sendError(res, error);
		} finally {
			debugApi && Logger.info(`API : Completed GET /tx/${req.params.txid}/hex`);
		}
	}

	/**
	 * Retrieve a page of transactions related to a wallet
	 */
	async getTransactions(req: HttpRequestLike, res: HttpResponseLike) {
		try {
			// Check request params
			if (!apiHelper.checkEntitiesParams(req.query))
				return HttpServer.sendError(res, errors.multiaddr.NOACT);

			// Parse params
			const active = apiHelper.parseEntities(req.query.active);
			const page =
				req.query.page == null ? 0 : Number.parseInt(req.query.page, 10);
			const count =
				req.query.count == null
					? keys.multiaddr.transactions
					: Number.parseInt(req.query.count, 10);
			const excludeNullXfer = req.query.excludeNullXfer != null;

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
			HttpServer.sendRawData(res, returnValue);
		} catch (error) {
			HttpServer.sendError(res, error);
		} finally {
			const stringParameters = `${req.query.active} \
        ${req.query.page || ""} \
        ${req.query.count || ""}`;

			debugApi && Logger.info(`API : Completed GET /txs ${stringParameters}`);
		}
	}

	/**
	 * Retrieve a utxo for a given txid and index
	 */
	async getTxOut(req: HttpRequestLike, res: HttpResponseLike) {
		if (!req.params.txid || !req.params.index) {
			return HttpServer.sendError(res, errors.params.INVALID);
		}

		const index = Number.parseInt(req.params.index, 10);

		if (Number.isNaN(index)) {
			return HttpServer.sendError(res, errors.params.INVALID);
		}

		try {
			const txout = await rpcTxns.rpcClient.gettxout({
				txid: req.params.txid,
				n: index,
			});

			HttpServer.sendOkDataOnly(res, txout);
		} catch {
			HttpServer.sendError(res, null, 404);
		}
	}

	/**
	 * Validate arguments of /tx requests
	 */
	validateArgsGetTransaction(
		req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		const isValidTxid = validator.isHash(req.params.txid, "sha256");

		const isValidFees =
			!req.query.fees || validator.isAlphanumeric(req.query.fees);

		if (isValidTxid && isValidFees) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				req.params,
				"API : HeadersRestApi.validateArgsGetTransaction() : Invalid arguments",
			);
			Logger.error(req.query, "");
		}
	}

	/**
	 * Validate arguments of /tx/:txid/hex requests
	 */
	validateArgsGetTransactionHex(
		req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		const isValidTxid = validator.isHash(req.params.txid, "sha256");

		if (isValidTxid) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				req.params,
				"API : HeadersRestApi.validateArgsGetTransactionHex() : Invalid arguments",
			);
		}
	}

	/**
	 * Validate arguments of /txs requests
	 */
	validateArgsGetTransactions(
		req: HttpRequestLike,
		res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		const isValidPage = !req.query.page || validator.isInt(req.query.page);

		const isValidCount = !req.query.count || validator.isInt(req.query.count);

		const isValidExcludeNull =
			!req.query.excludeNullXfer ||
			validator.isAlphanumeric(req.query.excludeNullXfer);

		if (isValidPage && isValidCount && isValidExcludeNull) {
			next();
		} else {
			HttpServer.sendError(res, errors.body.INVDATA);
			Logger.error(
				req.query,
				"API : HeadersRestApi.validateArgsGetTransactions() : Invalid arguments",
			);
		}
	}
}

export default TransactionsRestApi;

/*!
 * lib/bitcoin/hd-accounts-helper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BIP32Interface } from "bip32";
import { BIP32Factory } from "bip32";
import bs58check from "bs58check";
import QuickLRU from "quick-lru";
import * as ecc from "tiny-secp256k1";
import workerPool from "workerpool";
import keysFile from "../../keys/index.js";
import errors from "../errors.js";
import Logger from "../logger.js";
import addrHelper from "./addresses-helper.js";
import network from "./network.js";

const activeNet = network.network;
const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

const bip32 = BIP32Factory(ecc);

const MAX_SAFE_INT_32 = 2 ** 31 - 1;

export interface DerivedAddress {
	chain: number;
	index: number;
	address: string;
}

type HdNodeTuple = [BIP32Interface, BIP32Interface, BIP32Interface];

interface HdTypeInfo {
	type: number | null;
	locked: boolean;
}

interface ParallelDerivationMessage {
	status: "ok" | "error";
	addresses: DerivedAddress[];
	error?: unknown;
}

/**
 * A singleton providing HD Accounts helper functions
 */
class HDAccountsHelper {
	declare BIP44: number;
	declare BIP49: number;
	declare BIP84: number;
	declare LOCKED: number;
	declare RICOCHET_ACCT: number;
	declare POSTMIX_ACCT: number;
	declare PREMIX_ACCT: number;
	declare BADBANK_ACCT: number;
	declare MAGIC_XPUB: number;
	declare MAGIC_TPUB: number;
	declare MAGIC_YPUB: number;
	declare MAGIC_UPUB: number;
	declare MAGIC_ZPUB: number;
	declare MAGIC_VPUB: number;
	declare nodes: QuickLRU<string, HdNodeTuple>;
	declare externalDerivationActivated: boolean;
	declare derivationPool: ReturnType<typeof workerPool.pool> | null;
	/**
	 * Constructor
	 */
	constructor() {
		// HD accounts types
		this.BIP44 = 0;
		this.BIP49 = 1;
		this.BIP84 = 2;
		this.LOCKED = 1 << 7;

		// known HD accounts
		this.RICOCHET_ACCT = MAX_SAFE_INT_32;
		this.POSTMIX_ACCT = MAX_SAFE_INT_32 - 1;
		this.PREMIX_ACCT = MAX_SAFE_INT_32 - 2;
		this.BADBANK_ACCT = MAX_SAFE_INT_32 - 3;

		// Magic numbers
		this.MAGIC_XPUB = 0x0488b21e;
		this.MAGIC_TPUB = 0x043587cf;
		this.MAGIC_YPUB = 0x049d7cb2;
		this.MAGIC_UPUB = 0x044a5262;
		this.MAGIC_ZPUB = 0x04b24746;
		this.MAGIC_VPUB = 0x045f1cf6;

		// HD accounts cache
		this.nodes = new QuickLRU({
			// Maximum number of nodes to store in cache
			maxSize: 1000,
			// Maximum age for items in the cache. Items do not expire
			maxAge: Number.POSITIVE_INFINITY,
		});

		// Default = external addresses derivation deactivated
		this.externalDerivationActivated = false;
		this.derivationPool = null;
	}

	/**
	 * Activate external derivation of addresses
	 * (provides improved performances)
	 */
	activateExternalDerivation() {
		// Pool of child processes used for derivation of addresses
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = path.dirname(__filename);
		const poolKeys = keys.addrDerivationPool;

		this.derivationPool = workerPool.pool(
			`${__dirname}/parallel-address-derivation.js`,
			{
				maxWorkers: poolKeys.maxNbChildren,
				minWorkers: poolKeys.minNbChildren,
				workerType: "thread",
			},
		);
		this.externalDerivationActivated = true;
		Logger.info(
			`Created ${poolKeys.minNbChildren} worker threads for addresses derivation (max = ${poolKeys.maxNbChildren})`,
		);
	}

	/**
	 * Check if a string encodes a xpub/tpub
	 */
	isXpub(xpub?: string) {
		if (xpub == null) return false;
		return xpub.indexOf("xpub") === 0 || xpub.indexOf("tpub") === 0;
	}

	/**
	 * Check if a string encodes a ypub/upub
	 */
	isYpub(xpub?: string) {
		if (xpub == null) return false;
		return xpub.indexOf("ypub") === 0 || xpub.indexOf("upub") === 0;
	}

	/**
	 * Check if a string encodes a zpub/vpub
	 */
	isZpub(xpub?: string) {
		if (xpub == null) return false;
		return xpub.indexOf("zpub") === 0 || xpub.indexOf("vpub") === 0;
	}

	/**
	 * Translates
	 *  - a xpub/ypub/zpub into a xpub
	 *  - a tpub/upub/vpub into a tpub
	 */
	xlatXPUB(xpub?: string) {
		if (xpub == null) throw errors.xpub.INVALID;
		const decoded = bs58check.decode(xpub);
		const view = new DataView(decoded.buffer);
		const prefix = view.getUint32(0);

		if (prefix === this.MAGIC_XPUB || prefix === this.MAGIC_TPUB) return xpub;

		if (prefix === this.MAGIC_YPUB || prefix === this.MAGIC_ZPUB) {
			view.setUint32(0, this.MAGIC_XPUB);
		} else if (prefix === this.MAGIC_UPUB || prefix === this.MAGIC_VPUB) {
			view.setUint32(0, this.MAGIC_TPUB);
		} else {
			throw errors.xpub.INVALID;
		}

		return bs58check.encode(new Uint8Array(view.buffer));
	}

	/**
	 * Classify the hd account type retrieved from db
	 */
	classify(v = 0): HdTypeInfo {
		const returnValue: HdTypeInfo = {
			type: null,
			locked: false,
		};

		let p = v;

		if (p >= this.LOCKED) {
			returnValue.locked = true;
			p -= this.LOCKED;
		}

		switch (p) {
			case this.BIP44:
			case this.BIP49:
			case this.BIP84:
				returnValue.type = p;
				break;
		}

		return returnValue;
	}

	/**
	 * Encode hd account type and lock status in db format
	 */
	makeType(type = this.BIP44, locked?: boolean) {
		let p = type >= this.LOCKED ? type - this.LOCKED : type;

		locked = Boolean(locked);

		if (locked) p += this.LOCKED;

		return p;
	}

	/**
	 * Return a string representation of the hd account type
	 */
	typeString(v?: number) {
		const info = this.classify(v);

		const prefix = info.locked ? "LOCKED " : "";

		let suffix = "";

		switch (info.type) {
			case this.BIP44:
				suffix = "BIP44";
				break;
			case this.BIP49:
				suffix = "BIP49";
				break;
			case this.BIP84:
				suffix = "BIP84";
				break;
			default:
				suffix = "UNKNOWN";
				break;
		}

		return prefix + suffix;
	}

	/**
	 * Checks if a hd account is a valid bip32
	 */
	isValid(xpub?: string) {
		if (this.nodes.has(xpub)) return true;

		try {
			if (!(this.isXpub(xpub) || this.isYpub(xpub) || this.isZpub(xpub))) {
				throw errors.xpub.INVALID;
			}

			// Translate the xpub
			const xlatedXpub = this.xlatXPUB(xpub);

			// Parse input as an HD Node. Throws if invalid
			const node = bip32.fromBase58(xlatedXpub, activeNet);

			// Check and see if this is a private key
			if (!node.isNeutered()) throw errors.xpub.PRIVKEY;

			// Store the external and internal chain nodes in the proper indices.
			// Store the parent node as well, at index 2.
			this.nodes.set(xpub, [node.derive(0), node.derive(1), node]);
			return true;
		} catch (error) {
			if (error === errors.xpub.PRIVKEY) throw error;
			return false;
		}
	}

	/**
	 * Get the hd node associated to an hd account
	 */
	getNode(xpub?: string) {
		return this.isValid(xpub) ? this.nodes.get(xpub) : null;
	}

	/**
	 * Derives an address for an hd account
	 */
	async deriveAddress(
		chain: number,
		chainNode: BIP32Interface,
		index: number,
		type: number,
	): Promise<DerivedAddress> {
		// Derive M/chain/index
		const indexNode = chainNode.derive(index);

		const addr: DerivedAddress = {
			chain: chain,
			index: index,
			address: "",
		};

		switch (type) {
			case this.BIP44:
				addr.address = addrHelper.p2pkhAddress(indexNode.publicKey);
				break;
			case this.BIP49:
				addr.address = addrHelper.p2wpkhP2shAddress(indexNode.publicKey);
				break;
			case this.BIP84:
				addr.address = addrHelper.p2wpkhAddress(indexNode.publicKey);
				break;
		}

		return addr;
	}

	/**
	 * Derives addresses for an hd account
	 */
	async deriveAddresses(
		xpub?: string,
		chain = 0,
		indices: number[] = [],
		type?: number,
	): Promise<DerivedAddress[]> {
		const node = this.getNode(xpub);

		if (node == null) throw errors.xpub.INVALID;

		if (chain > 1 || chain < 0) throw errors.xpub.CHAIN;

		if (type == null) type = this.makeType(this.BIP44, false);

		const info = this.classify(type);
		if (info.type == null) throw errors.xpub.SEGWIT;

		// Node at M/chain
		const chainNode = node[chain];

		// Optimization: if number of addresses beyond a given treshold
		// derivation is done in a child process
		if (
			this.externalDerivationActivated &&
			indices.length > keys.addrDerivationPool.thresholdParallelDerivation
		) {
			// Many addresses to be derived
			// Let's do it in a child process
			try {
				if (this.derivationPool == null)
					throw new Error("Derivation pool is not initialized");
				const data = {
					xpub: this.xlatXPUB(xpub),
					chain: chain,
					indices: indices,
					type: info.type,
					isPostmixChange: this.isPostmixAcct(node) && chain === 1,
				};

				const message = (await this.derivationPool.exec("deriveAddresses", [
					data,
				])) as ParallelDerivationMessage;

				if (message.status === "ok") {
					return message.addresses;
				} else {
					Logger.error(
						message.error,
						"HdAccountsHelper : A problem was met during parallel addresses derivation",
					);
					return [];
				}
			} catch (error) {
				Logger.error(
					error,
					"HdAccountsHelper : A problem was met during parallel addresses derivation",
				);
				throw error;
			}
		} else {
			// Few addresses to be derived or external derivation deactivated
			// Let's do it here
			const promises = indices.map((index?: number) => {
				return this.deriveAddress(chain, chainNode, index, info.type);
			});

			// Generate additional change address types for postmix account
			if (this.isPostmixAcct(node) && chain === 1) {
				for (const index of indices) {
					promises.push(
						this.deriveAddress(chain, chainNode, index, this.BIP44),
						this.deriveAddress(chain, chainNode, index, this.BIP49),
					);
				}
			}

			const addresses = await Promise.all(promises);

			return addresses;
		}
	}

	/**
	 * @description Detect postmix account
	 */
	isPostmixAcct(node: HdNodeTuple) {
		const index = node[2].index;
		const threshold = 2 ** 31;
		const hardened = index >= threshold;
		const account = hardened ? index - threshold : index;

		return account === this.POSTMIX_ACCT;
	}
}

export default new HDAccountsHelper();

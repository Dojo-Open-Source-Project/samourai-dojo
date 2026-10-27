/*!
 * lib/bitcoin/addresses-helper.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { bitcoinMessageFactory } from "@dojo-tools/bitcoinjs-message";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import Logger from "../logger.js";
import network from "./network.js";

bitcoin.initEccLib(ecc);
const btcMessage = bitcoinMessageFactory(ecc);

const activeNet = network.network;
const { p2pkh, p2sh, p2wpkh, p2wsh, p2tr } = bitcoin.payments;
const { OPS } = bitcoin.script;

/**
 * A singleton providing Addresses helper functions
 */
class AddressesHelper {
	/**
	 * Derives a P2PKH from a public key
	 */
	p2pkhAddress(pubKeyBuffer: Buffer): string {
		return p2pkh({
			pubkey: pubKeyBuffer,
			network: activeNet,
		}).address as string;
	}

	/**
	 * Derives a P2WPKH-P2SH from a public key
	 */
	p2wpkhP2shAddress(pubKeyBuffer: Buffer): string {
		return p2sh({
			redeem: p2wpkh({
				pubkey: pubKeyBuffer,
				network: activeNet,
			}),
			network: activeNet,
		}).address as string;
	}

	/**
	 * Derives a P2WPKH from a public key
	 */
	p2wpkhAddress(pubKeyBuffer: Buffer): string {
		return p2wpkh({
			pubkey: pubKeyBuffer,
			network: activeNet,
		}).address?.toLowerCase() as string;
	}

	/**
	 * Verify the signature of a given message
	 */
	verifySignature(msg: string, address: string, sig: string) {
		try {
			const prefix = activeNet.messagePrefix;
			return btcMessage.verify(msg, address, sig, prefix);
		} catch {
			return false;
		}
	}

	/**
	 * Checks if a string seems like a supported pubkey
	 */
	isSupportedPubKey(str: string) {
		return str.length === 66 && (str.startsWith("02") || str.startsWith("03"));
	}

	/**
	 * Check if string is a Bech32 address
	 */
	isBech32(str: string) {
		try {
			bitcoin.address.fromBech32(str);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get the script hash associated to a Bech32 address
	 */
	getScriptHashFromBech32(str: string) {
		try {
			return bitcoin.address.fromBech32(str).data.toString("hex");
		} catch (error) {
			Logger.error(error, "AddressesHelper : getScriptHashFromBech32()");
			return null;
		}
	}

	/**
	 * Check if an output script is an OP_RETURN script
	 */
	isOPReturnScript(scriptpubkey: Buffer) {
		return scriptpubkey[0] === OPS.OP_RETURN;
	}

	/**
	 * Check if an output script is a P2PKH script
	 */
	isP2pkhScript(scriptpubkey: Buffer) {
		return (
			scriptpubkey.length === 25 &&
			scriptpubkey[0] === OPS.OP_DUP &&
			scriptpubkey[1] === OPS.OP_HASH160 &&
			scriptpubkey[2] === 0x14 &&
			scriptpubkey[23] === OPS.OP_EQUALVERIFY &&
			scriptpubkey[24] === OPS.OP_CHECKSIG
		);
	}

	/**
	 * Check if an output script is a P2SH script
	 */
	isP2shScript(scriptpubkey: Buffer) {
		return (
			scriptpubkey.length === 23 &&
			scriptpubkey[0] === OPS.OP_HASH160 &&
			scriptpubkey[1] === 0x14 &&
			scriptpubkey[22] === OPS.OP_EQUAL
		);
	}

	/**
	 * Check if an output script is a P2WPKH script
	 */
	isP2wpkhScript(scriptpubkey: Buffer) {
		return (
			scriptpubkey.length === 22 &&
			scriptpubkey[0] === OPS.OP_0 &&
			scriptpubkey[1] === 0x14
		);
	}

	/**
	 * Check if an output script is a P2WSH script
	 */
	isP2wshScript(scriptpubkey: Buffer) {
		return (
			scriptpubkey.length === 34 &&
			scriptpubkey[0] === OPS.OP_0 &&
			scriptpubkey[1] === 0x20
		);
	}

	/**
	 * Check if an output script is a P2TR script
	 */
	isP2trScript(scriptpubkey: Buffer) {
		return (
			scriptpubkey.length === 34 &&
			scriptpubkey[0] === OPS.OP_1 &&
			scriptpubkey[1] === 0x20
		);
	}

	/**
	 * Return the bitcoin address corresponding to an output script
	 */
	outputScript2Address(scriptpubkey: Buffer): string | null {
		try {
			if (this.isOPReturnScript(scriptpubkey)) return null;

			if (this.isP2pkhScript(scriptpubkey))
				return (
					p2pkh({
						output: scriptpubkey,
						network: activeNet,
					}).address ?? null
				);

			if (this.isP2shScript(scriptpubkey))
				return (
					p2sh({
						output: scriptpubkey,
						network: activeNet,
					}).address ?? null
				);

			if (this.isP2wpkhScript(scriptpubkey))
				return (
					p2wpkh({
						output: scriptpubkey,
						network: activeNet,
					}).address ?? null
				);

			if (this.isP2wshScript(scriptpubkey))
				return (
					p2wsh({
						output: scriptpubkey,
						network: activeNet,
					}).address ?? null
				);

			if (this.isP2trScript(scriptpubkey)) {
				return (
					p2tr({
						output: scriptpubkey,
						network: activeNet,
					}).address ?? null
				);
			}
		} catch (error) {
			Logger.error(error, "AddressesHelper : outputScript2Address()");
		}

		return null;
	}
}

export default new AddressesHelper();

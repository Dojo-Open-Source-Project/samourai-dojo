/*!
 * lib/bitcoin/parallel-address-derivation.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import type { BIP32Interface } from "bip32";
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import workerPool from "workerpool";

import errors from "../errors.js";
import addrHelper from "./addresses-helper.js";
import network from "./network.js";

const activeNet = network.network;

const bip32 = BIP32Factory(ecc);

/**
 * Constants duplicated from HDAccountsHelper
 */
const BIP44 = 0;
const BIP49 = 1;
const BIP84 = 2;

interface DerivedAddress {
	chain: number;
	index: number;
	address: string;
}

interface DeriveAddressesMessage {
	xpub: string;
	chain: number;
	indices: number[];
	type: number;
	isPostmixChange: boolean;
}

/**
 * Derives an address for an hd account
 */
function deriveAddress(
	chain: number,
	chainNode: BIP32Interface,
	index: number,
	type: number,
): DerivedAddress {
	// Derive M/chain/index
	const indexNode = chainNode.derive(index);

	const addr: DerivedAddress = {
		chain: chain,
		index: index,
		address: "",
	};

	switch (type) {
		case BIP44:
			addr.address = addrHelper.p2pkhAddress(indexNode.publicKey);
			break;
		case BIP49:
			addr.address = addrHelper.p2wpkhP2shAddress(indexNode.publicKey);
			break;
		case BIP84:
			addr.address = addrHelper.p2wpkhAddress(indexNode.publicKey);
			break;
	}

	return addr;
}

/**
 * Derives a set of addresses for an hd account
 */
function deriveAddresses(msg: DeriveAddressesMessage) {
	try {
		const xpub = msg.xpub;
		const chain = msg.chain;
		const indices = msg.indices;
		const type = msg.type;
		const isPostmixChange = msg.isPostmixChange;

		// Parse input as an HD Node. Throws if invalid
		const node = bip32.fromBase58(xpub, activeNet);

		// Check and see if this is a private key
		if (!node.isNeutered()) throw errors.xpub.PRIVKEY;

		const chainNode = node.derive(chain);

		const addresses = indices.map((index) => {
			return deriveAddress(chain, chainNode, index, type);
		});

		// Generate additional change address types for postmix account
		if (isPostmixChange) {
			for (const index of indices) {
				addresses.push(
					deriveAddress(chain, chainNode, index, BIP44),
					deriveAddress(chain, chainNode, index, BIP49),
				);
			}
		}

		// Send response to parent process
		return {
			status: "ok",
			addresses: addresses,
		};
	} catch (error) {
		return {
			status: "error",
			addresses: [] as DerivedAddress[],
			error: JSON.stringify(error),
		};
	}
}

workerPool.worker({
	deriveAddresses: deriveAddresses,
});

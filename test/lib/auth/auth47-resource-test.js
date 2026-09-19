/**
 * test/lib/auth/auth47-resource-test.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import assert from "node:assert";
import { Auth47Verifier } from "@dojo-tools/auth47";
import { BIP47Factory } from "@dojo-tools/bip47";
import { networks } from "@dojo-tools/bip47/utils";
import { bitcoinMessageFactory } from "@dojo-tools/bitcoinjs-message";
import * as ecc from "tiny-secp256k1";
import {
	isExpectedResource,
	SOROBAN_RESOURCE,
	verifyChallengeResource,
} from "../../../lib/auth/auth47-resource.js";

const DOJO_URL = "http://dojohostname.onion/test/v2/auth/auth47/authenticate";
const SOROBAN_URL = `${DOJO_URL}/soroban`;
const NONCE = "f9a1b2c3d4e5f60718293a4b";

const bip47 = BIP47Factory(ecc);
const bitcoinjsMessage = bitcoinMessageFactory(ecc);
const verifier = new Auth47Verifier(ecc, DOJO_URL);

// Stand-in for the Dojo owner's wallet
const wallet = bip47.fromSeed(Buffer.alloc(64, 42), 0, networks.testnet);
const paymentCode = wallet.toPaymentCodePublic().toBase58();

/**
 * Build a genuine proof over any challenge
 * @param {string} challenge - challenge to be signed
 * @returns {object}
 */
function proofFor(challenge) {
	const signature = bitcoinjsMessage.sign(
		challenge,
		wallet.getNotificationPrivateKey(),
		true,
		networks.testnet.messagePrefix,
	);

	return {
		auth47_response: "1.0",
		challenge: challenge,
		signature: Buffer.from(signature).toString("base64"),
		nym: paymentCode,
	};
}

describe("Auth47 resource binding", () => {
	describe("isExpectedResource()", () => {
		it("should accept the expected resource", () => {
			assert(isExpectedResource(DOJO_URL, DOJO_URL));
		});

		it("should ignore a trailing slash", () => {
			assert(isExpectedResource(`${DOJO_URL}/`, DOJO_URL));
		});

		it("should accept a wallet reporting the origin alone", () => {
			assert(isExpectedResource("http://dojohostname.onion", DOJO_URL));
		});

		it("should reject another origin", () => {
			assert(!isExpectedResource("http://evil.onion/callback", DOJO_URL));
		});

		it("should reject another scheme on the same host", () => {
			assert(
				!isExpectedResource(
					"https://dojohostname.onion/test/v2/auth/auth47/authenticate",
					DOJO_URL,
				),
			);
		});

		it("should reject another path on the same origin", () => {
			assert(
				!isExpectedResource(
					"http://dojohostname.onion/not-our-callback",
					DOJO_URL,
				),
			);
		});

		it("should reject a non-url resource", () => {
			assert(!isExpectedResource(SOROBAN_RESOURCE, DOJO_URL));
			assert(!isExpectedResource(null, DOJO_URL));
		});
	});

	describe("verifyChallengeResource()", () => {
		it("should accept a challenge naming this dojo and return its nonce", () => {
			const result = verifyChallengeResource(
				`auth47://${NONCE}?r=${DOJO_URL}&e=2000000000`,
				DOJO_URL,
			);

			assert.strictEqual(result.result, "ok");
			assert.strictEqual(result.nonce, NONCE);
		});

		it("should reject a challenge naming another site (relay attack)", () => {
			const result = verifyChallengeResource(
				`auth47://${NONCE}?r=http://evil.onion/callback&e=2000000000`,
				DOJO_URL,
			);

			assert.strictEqual(result.result, "error");
			assert.strictEqual(
				result.error,
				"proof was signed for a different resource",
			);
		});

		it("should reject a challenge without resource", () => {
			const result = verifyChallengeResource(
				`auth47://${NONCE}?e=2000000000`,
				DOJO_URL,
			);

			assert.strictEqual(result.result, "error");
			assert.strictEqual(result.error, "missing resource");
		});

		it("should reject an invalid challenge", () => {
			assert.strictEqual(
				verifyChallengeResource(`http://${NONCE}?r=${DOJO_URL}`, DOJO_URL)
					.result,
				"error",
			);
			assert.strictEqual(
				verifyChallengeResource("not an url", DOJO_URL).result,
				"error",
			);
			assert.strictEqual(
				verifyChallengeResource(null, DOJO_URL).result,
				"error",
			);
		});

		it("should refuse to verify when no resource is expected", () => {
			const result = verifyChallengeResource(
				`auth47://${NONCE}?r=${DOJO_URL}`,
				null,
			);

			assert.strictEqual(result.result, "error");
			assert.strictEqual(result.error, "missing expected resource");
		});

		it("should reject the soroban resource by default", () => {
			const result = verifyChallengeResource(
				`auth47://${NONCE}?r=${SOROBAN_RESOURCE}`,
				SOROBAN_URL,
			);

			assert.strictEqual(result.result, "error");
		});

		it("should accept the soroban resource when allowed", () => {
			const result = verifyChallengeResource(
				`auth47://${NONCE}?r=${SOROBAN_RESOURCE}`,
				SOROBAN_URL,
				{ allowSorobanResource: true },
			);

			assert.strictEqual(result.result, "ok");
			assert.strictEqual(result.nonce, NONCE);
		});

		it("should reject a challenge naming another site even when the soroban resource is allowed", () => {
			const result = verifyChallengeResource(
				`auth47://${NONCE}?r=http://evil.onion/callback`,
				SOROBAN_URL,
				{ allowSorobanResource: true },
			);

			assert.strictEqual(result.result, "error");
		});
	});

	describe("relayed proof", () => {
		it("should be rejected although its signature is genuine", () => {
			const challenge = `auth47://${NONCE}?r=http://evil.onion/callback&e=2000000000`;
			const proof = proofFor(challenge);

			// The proof really is signed by the dojo owner, this is the point
			// of the test : the library accepts it, the resource binding does not
			assert.strictEqual(
				verifier.verifyProof(proof, "testnet").result,
				"ok",
				"test is meaningless unless the signature is genuine",
			);

			assert.strictEqual(
				verifyChallengeResource(proof.challenge, DOJO_URL).result,
				"error",
			);
		});

		it("should be accepted when signed for this dojo", () => {
			const challenge = `auth47://${NONCE}?r=${DOJO_URL}&e=2000000000`;
			const proof = proofFor(challenge);

			assert.strictEqual(verifier.verifyProof(proof, "testnet").result, "ok");

			const result = verifyChallengeResource(proof.challenge, DOJO_URL);

			assert.strictEqual(result.result, "ok");
			assert.strictEqual(result.nonce, NONCE);
		});
	});
});

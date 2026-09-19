/*!
 * lib/auth/auth47-resource.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

/**
 * Resource binding for Auth47 proofs.
 *
 * Auth47Verifier.verifyProof() answers "is this proof signed?", not "is this
 * proof signed for me?". It checks that the challenge carries a resource ("r")
 * parsing as an http(s) URL, but it has no way to know which URL is ours.
 *
 * Without the comparison implemented here, an attacker able to reach this Dojo
 * can request a live nonce from it, display to the Dojo owner a challenge
 * carrying that nonce but naming the attacker's site as the resource, and relay
 * the owner's genuine signature back here to open an admin session. Nonce
 * expiry, the payment code allow list and signature validity do not prevent
 * that relay, only binding the proof to this Dojo's own resource does.
 */

/**
 * Resource used by proofs targeting the Soroban network
 * @type {string}
 */
export const SOROBAN_RESOURCE = "srbn";

/**
 * Parse an URL, returning null instead of throwing on invalid input
 * @param {unknown} value - value to be parsed
 * @returns {URL | null}
 */
function parseUrl(value) {
	if (typeof value !== "string") return null;
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

/**
 * Remove trailing slashes from a path
 * @param {string} pathname - path
 * @returns {string}
 */
function trimPath(pathname) {
	return pathname.replace(/\/+$/, "");
}

/**
 * Check if a resource sent by a wallet points to an expected resource.
 * A trailing slash must not make a different site, a different origin must.
 * Wallets reporting the origin alone (no path) are accepted, since the origin
 * is what binds the proof to this Dojo.
 * @param {unknown} resource - resource received in a challenge
 * @param {string} expectedResource - resource expected by this Dojo
 * @returns {boolean}
 */
export function isExpectedResource(resource, expectedResource) {
	const received = parseUrl(resource);
	const expected = parseUrl(expectedResource);

	if (!received || !expected) return false;
	if (received.search !== "" || received.hash !== "") return false;
	if (received.origin !== expected.origin) return false;

	const receivedPath = trimPath(received.pathname);

	return receivedPath === "" || receivedPath === trimPath(expected.pathname);
}

/**
 * @typedef {{ result: 'ok', nonce: string, resource: string }} ResourceCheckSuccess
 * @typedef {{ result: 'error', error: string }} ResourceCheckError
 */

/**
 * Check that a challenge was signed for a resource served by this Dojo
 * and extract its nonce.
 * @param {unknown} challenge - challenge received in a proof
 * @param {string | null} expectedResource - resource expected by this Dojo
 * @param {object} [options] - options
 * @param {boolean} [options.allowSorobanResource] - accept the Soroban resource
 * @returns {ResourceCheckSuccess | ResourceCheckError}
 */
export function verifyChallengeResource(
	challenge,
	expectedResource,
	{ allowSorobanResource = false } = {},
) {
	if (!expectedResource) {
		// Refuse to verify rather than accept a proof signed for anyone
		return { result: "error", error: "missing expected resource" };
	}

	const challengeUrl = parseUrl(challenge);

	if (challengeUrl?.protocol !== "auth47:") {
		return { result: "error", error: "invalid challenge" };
	}

	const nonce = challengeUrl.hostname;

	if (!nonce) {
		return { result: "error", error: "invalid nonce" };
	}

	const resource = challengeUrl.searchParams.get("r");

	if (resource === null) {
		return { result: "error", error: "missing resource" };
	}

	if (allowSorobanResource && resource === SOROBAN_RESOURCE) {
		return { result: "ok", nonce: nonce, resource: resource };
	}

	if (!isExpectedResource(resource, expectedResource)) {
		return {
			result: "error",
			error: "proof was signed for a different resource",
		};
	}

	return { result: "ok", nonce: nonce, resource: resource };
}

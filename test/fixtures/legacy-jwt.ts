import { createHmac } from "node:crypto";

// Produce the HS256 wire format used by jsonwebtoken without depending on it.
export function legacyJwt(
	payload: Record<string, unknown>,
	secret = "test-secret",
	alg = "HS256",
) {
	const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString(
		"base64url",
	);
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signature = createHmac(alg === "HS384" ? "sha384" : "sha256", secret)
		.update(`${header}.${body}`)
		.digest("base64url");
	return `${header}.${body}.${signature}`;
}

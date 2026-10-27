/*!
 * lib/auth/authorizations-manager.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import { sign, verify } from "hono/jwt";
import validator from "validator";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import errors from "../errors.js";
import Logger from "../logger.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

interface DojoJwtPayload extends UnknownRecord {
	type: string;
	prf?: unknown;
}

const isDojoJwtPayload = (payload: unknown): payload is DojoJwtPayload =>
	payload != null &&
	typeof payload === "object" &&
	!Array.isArray(payload) &&
	"type" in payload &&
	typeof payload.type === "string";

const stringValue = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

function lifetimeSeconds(expires: string | number): number {
	if (typeof expires === "number") return expires;
	// Preserve legacy duration strings. Bare strings are milliseconds; numbers
	// in the Dojo configuration are seconds.
	const match =
		expires.length <= 100 &&
		/^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
			expires,
		);
	if (!match) return Number.NaN;
	const unit = match[2]?.toLowerCase() ?? "ms";
	const secondsPerUnit: Record<string, number> = {
		s: 1,
		m: 60,
		h: 3600,
		d: 86400,
		w: 604800,
		y: 31557600,
	};
	return (
		Number(match[1]) *
		(/^m(?:s|ill)/.test(unit) ? 0.001 : secondsPerUnit[unit[0]])
	);
}

class AuthorizationsManager {
	readonly JWT_ALGO = "HS256";
	readonly ISS = "Samourai Dojo";
	readonly TOKEN_TYPE_ACCESS = "access-token";
	readonly TOKEN_TYPE_REFRESH = "refresh-token";
	readonly TOKEN_PROFILE_API = "api";
	readonly TOKEN_PROFILE_ADMIN = "admin";
	authActive = keys.auth.activeStrategy != null;
	_secret = keys.auth.jwt.secret;
	isMandatory = keys.auth.mandatory;
	accessTokenExpires = keys.auth.jwt.accessToken.expires;
	refreshTokenExpires = keys.auth.jwt.refreshToken.expires;

	async generateAuthorizations(c: HttpContext, next: HttpNext) {
		const user = c.get("user");
		if (!user?.authenticated) throw new Error(errors.auth.TECH_ISSUE);
		const accessToken = await this._generateAccessToken(user);
		const refreshToken = await this._generateRefreshToken(user);
		c.set("authorizations", {
			access_token: accessToken,
			refresh_token: refreshToken,
		});
		await next();
	}

	async refreshAuthorizations(c: HttpContext, next: HttpNext) {
		if (!this.authActive) return next();
		const refreshToken = this._extractRefreshToken(c);
		if (!refreshToken) throw new Error(errors.auth.MISSING_JWT);
		let decoded: DojoJwtPayload;
		try {
			decoded = await this._verifyRefreshToken(refreshToken);
		} catch (error) {
			Logger.error(error, errors.auth.INVALID_JWT);
			throw new Error(errors.auth.INVALID_JWT);
		}
		const user = c.get("user") ?? {};
		user.profile = decoded.prf;
		c.set("user", user);
		c.set("authorizations", {
			access_token: await this._generateAccessToken(user),
		});
		await next();
	}

	async revokeAuthorizations(_c: HttpContext, next: HttpNext) {
		// Tokens are not revoked by the existing logout endpoint.
		await next();
	}

	async checkAuthentication(c: HttpContext, next: HttpNext) {
		if (!this.authActive) return next();
		const token = this._extractAccessToken(c);
		if (this.isMandatory || token) {
			try {
				const decodedToken = await this.isAuthenticated(token);
				c.set("authorizations", { decoded_access_token: decodedToken });
			} catch (error) {
				throw new Error(String(error));
			}
		}
		await next();
	}

	async checkHasAdminProfile(c: HttpContext, next: HttpNext) {
		if (!this.authActive) return next();
		const token = this._extractAccessToken(c);
		let decodedToken: DojoJwtPayload;
		try {
			decodedToken = await this.isAuthenticated(token);
		} catch (error) {
			throw new Error(String(error));
		}
		if (decodedToken.prf !== this.TOKEN_PROFILE_ADMIN)
			throw new Error(errors.auth.INVALID_PRF);
		c.set("authorizations", { decoded_access_token: decodedToken });
		await next();
	}

	async isAuthenticated(token?: string): Promise<DojoJwtPayload> {
		if (!token) {
			Logger.error(null, errors.auth.MISSING_JWT);
			throw errors.auth.MISSING_JWT;
		}
		try {
			return await this._verifyAccessToken(token);
		} catch {
			throw errors.auth.INVALID_JWT;
		}
	}

	_generateAccessToken(user?: UnknownRecord) {
		return this.generateToken(
			this.TOKEN_TYPE_ACCESS,
			this.accessTokenExpires,
			user,
		);
	}

	_extractAccessToken(c: HttpContext) {
		const token = this._extractBearerAuthorizationHeader(c);
		if (token) return token;
		const bodyToken = stringValue(c.get("body")?.at);
		if (bodyToken != null && validator.isJWT(bodyToken)) return bodyToken;
		const queryToken = c.req.query("at");
		if (queryToken != null && validator.isJWT(queryToken)) return queryToken;
		return null;
	}

	async _verifyAccessToken(token?: string): Promise<DojoJwtPayload> {
		const payload: unknown = await verify(token, this._secret, {
			alg: this.JWT_ALGO,
			iat: false, // jsonwebtoken did not reject tokens for a future issued-at claim.
		});
		if (!isDojoJwtPayload(payload) || payload.type !== this.TOKEN_TYPE_ACCESS)
			throw errors.auth.INVALID_JWT;
		return payload;
	}

	_generateRefreshToken(user?: UnknownRecord) {
		return this.generateToken(
			this.TOKEN_TYPE_REFRESH,
			this.refreshTokenExpires,
			user,
		);
	}

	_extractRefreshToken(c: HttpContext) {
		const token = this._extractBearerAuthorizationHeader(c);
		if (token) return token;
		const bodyToken = stringValue(c.get("body")?.rt);
		if (bodyToken != null && validator.isJWT(bodyToken)) return bodyToken;
		const queryToken = c.req.query("rt");
		if (queryToken != null && validator.isJWT(queryToken)) return queryToken;
		return null;
	}

	async _verifyRefreshToken(token?: string): Promise<DojoJwtPayload> {
		const payload: unknown = await verify(token, this._secret, {
			alg: this.JWT_ALGO,
			iat: false,
		});
		if (!isDojoJwtPayload(payload) || payload.type !== this.TOKEN_TYPE_REFRESH)
			throw errors.auth.INVALID_JWT;
		return payload;
	}

	_extractBearerAuthorizationHeader(c: HttpContext) {
		const authHeader = c.req.header("Authorization");
		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.slice(7);
			if (validator.isJWT(token)) return token;
		}
		return null;
	}

	private generateToken(
		type: string,
		expires: string | number,
		user?: UnknownRecord,
	) {
		const iat = Math.floor(Date.now() / 1000);
		const duration = lifetimeSeconds(expires);
		if (!Number.isFinite(duration))
			throw new Error("Invalid JWT token lifetime");
		return sign(
			{
				iss: this.ISS,
				type,
				prf: user?.profile,
				iat,
				exp: Math.floor(iat + duration),
			},
			this._secret,
			this.JWT_ALGO,
		);
	}
}

export default new AuthorizationsManager();

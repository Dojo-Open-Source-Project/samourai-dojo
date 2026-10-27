/*!
 * lib/auth/authorizations-manager.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import type { Algorithm, JwtPayload, SignOptions } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import validator from "validator";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import errors from "../errors.js";
import Logger from "../logger.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

interface DojoJwtPayload extends JwtPayload {
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

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */

/**
 * A singleton managing authorizations the API
 */
class AuthorizationsManager {
	declare JWT_ALGO: Algorithm;
	declare ISS: string;
	declare TOKEN_TYPE_ACCESS: string;
	declare TOKEN_TYPE_REFRESH: string;
	declare TOKEN_PROFILE_API: string;
	declare TOKEN_PROFILE_ADMIN: string;
	declare authActive: boolean;
	declare _secret: string;
	declare isMandatory: boolean;
	declare accessTokenExpires: SignOptions["expiresIn"];
	declare refreshTokenExpires: SignOptions["expiresIn"];
	/**
	 * Constructor
	 */
	constructor() {
		// Constants
		this.JWT_ALGO = "HS256";
		this.ISS = "Samourai Wallet backend";
		this.TOKEN_TYPE_ACCESS = "access-token";
		this.TOKEN_TYPE_REFRESH = "refresh-token";
		this.TOKEN_PROFILE_API = "api";
		this.TOKEN_PROFILE_ADMIN = "admin";

		this.authActive = keys.auth.activeStrategy != null;
		this._secret = keys.auth.jwt.secret;
		this.isMandatory = keys.auth.mandatory;
		this.accessTokenExpires = keys.auth.jwt.accessToken
			.expires as SignOptions["expiresIn"];
		this.refreshTokenExpires = keys.auth.jwt.refreshToken
			.expires as SignOptions["expiresIn"];
	}

	/**
	 * Middleware generating authorization token
	 */
	generateAuthorizations(
		req: HttpRequestLike,
		_res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		if (!req.user?.authenticated) return next(errors.auth.TECH_ISSUE);

		// Generates an access token
		const accessToken = this._generateAccessToken(req.user);

		// Generates a refresh token
		const refreshToken = this._generateRefreshToken(req.user);

		// Stores the tokens in the request
		req.authorizations = {
			access_token: accessToken,
			refresh_token: refreshToken,
		};

		next();
	}

	/**
	 * Middleware refreshing authorizations
	 */
	refreshAuthorizations(
		req: HttpRequestLike,
		_res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		// Check if authentication is activated
		if (!this.authActive) return next();

		// Authentication is activated
		// A refresh token is required
		const refreshToken = this._extractRefreshToken(req);

		if (!refreshToken) return next(errors.auth.MISSING_JWT);

		try {
			const decodedRefrehToken = this._verifyRefreshToken(refreshToken);
			if (req.user == null) {
				req.user = {};
			}
			req.user.profile = decodedRefrehToken.prf;
		} catch (error) {
			Logger.error(error, `${errors.auth.INVALID_JWT}: ${refreshToken}`);
			return next(errors.auth.INVALID_JWT);
		}

		// Generates a new access token
		const accessToken = this._generateAccessToken(req.user);

		// Stores the access token in the request
		req.authorizations = {
			access_token: accessToken,
		};

		next();
	}

	/**
	 * Middleware revoking authorizations
	 */
	revokeAuthorizations(
		_req: HttpRequestLike,
		_res: HttpResponseLike,
		_next: NextFunctionLike,
	) {
		// Nothing to do (for now)
	}

	/**
	 * Middleware checking if user is authenticated
	 */
	checkAuthentication(
		req: HttpRequestLike,
		_res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		// Check if authentication is activated
		if (!this.authActive) return next();

		// Authentication is activated
		// A JSON web token is required
		const token = this._extractAccessToken(req);

		if (this.isMandatory || token) {
			try {
				const decodedToken = this.isAuthenticated(token);
				req.authorizations = { decoded_access_token: decodedToken };
				next();
			} catch (error) {
				return next(error);
			}
		} else {
			next();
		}
	}

	/**
	 * Middleware checking if user is authenticated and has admin profile
	 */
	checkHasAdminProfile(
		req: HttpRequestLike,
		_res: HttpResponseLike,
		next: NextFunctionLike,
	) {
		// Check if authentication is activated
		if (!this.authActive) return next();

		// Authentication is activated
		// A JSON web token is required
		const token = this._extractAccessToken(req);

		try {
			const decodedToken = this.isAuthenticated(token);
			if (decodedToken.prf === this.TOKEN_PROFILE_ADMIN) {
				req.authorizations = { decoded_access_token: decodedToken };
				next();
			} else {
				return next(errors.auth.INVALID_PRF);
			}
		} catch (error) {
			return next(error);
		}
	}

	/**
	 * Check if user is authenticated
	 * (i.e. we have received a valid json web token)
	 * @throws {string} an exception otherwise
	 */
	isAuthenticated(token?: string): DojoJwtPayload {
		if (!token) {
			Logger.error(null, `${errors.auth.MISSING_JWT}`);
			throw errors.auth.MISSING_JWT;
		}

		try {
			return this._verifyAccessToken(token);
		} catch {
			//Logger.error(e, `${errors.auth.INVALID_JWT}: ${token}`)
			throw errors.auth.INVALID_JWT;
		}
	}

	/**
	 * Generate an access token
	 */
	_generateAccessToken(user?: UnknownRecord) {
		// Builds claims
		const claims = {
			iss: this.ISS,
			type: this.TOKEN_TYPE_ACCESS,
			prf: user?.profile,
		};

		// Builds and signs the access token
		return jwt.sign(claims, this._secret, {
			expiresIn: this.accessTokenExpires,
			algorithm: this.JWT_ALGO,
		});
	}

	/**
	 * Extract the access token from the http request
	 */
	_extractAccessToken(req: HttpRequestLike) {
		const token = this._extractBearerAuthorizationHeader(req);
		if (token) return token;

		const bodyToken = stringValue(req.body?.at);
		if (bodyToken != null && validator.isJWT(bodyToken)) return bodyToken;

		const queryToken = stringValue(req.query?.at);
		if (queryToken != null && validator.isJWT(queryToken)) return queryToken;

		return null;
	}

	/**
	 * Verify an access token
	 */
	_verifyAccessToken(token?: string): DojoJwtPayload {
		const payload: unknown = jwt.verify(token, this._secret, {
			algorithms: [this.JWT_ALGO],
		});

		if (!isDojoJwtPayload(payload)) throw errors.auth.INVALID_JWT;
		if (payload.type !== this.TOKEN_TYPE_ACCESS) throw errors.auth.INVALID_JWT;

		return payload;
	}

	/**
	 * Generate an refresh token
	 */
	_generateRefreshToken(user?: UnknownRecord) {
		// Builds claims
		const claims = {
			iss: this.ISS,
			type: this.TOKEN_TYPE_REFRESH,
			prf: user?.profile,
		};
		// Builds and signs the access token
		return jwt.sign(claims, this._secret, {
			expiresIn: this.refreshTokenExpires,
			algorithm: this.JWT_ALGO,
		});
	}

	/**
	 * Extract the refresh token from the http request
	 */
	_extractRefreshToken(req: HttpRequestLike) {
		const token = this._extractBearerAuthorizationHeader(req);
		if (token) return token;

		const bodyToken = stringValue(req.body?.rt);
		if (bodyToken != null && validator.isJWT(bodyToken)) return bodyToken;

		const queryToken = stringValue(req.query?.rt);
		if (queryToken != null && validator.isJWT(queryToken)) return queryToken;

		return null;
	}

	/**
	 * Verify a refresh token
	 */
	_verifyRefreshToken(token?: string): DojoJwtPayload {
		const payload: unknown = jwt.verify(token, this._secret, {
			algorithms: [this.JWT_ALGO],
		});

		if (!isDojoJwtPayload(payload)) throw errors.auth.INVALID_JWT;
		if (payload.type !== this.TOKEN_TYPE_REFRESH) throw errors.auth.INVALID_JWT;

		return payload;
	}

	/**
	 * Extract a bearer JWT auth token
	 * from the Authorization HTTP header
	 * Returns null if it doesn't exist or is an onvalid JWT
	 */
	_extractBearerAuthorizationHeader(req: HttpRequestLike) {
		const authHeader = req.get("Authorization");

		if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
			const token = authHeader.slice(7);
			if (validator.isJWT(token)) return token;
		}

		return null;
	}
}

export default new AuthorizationsManager();

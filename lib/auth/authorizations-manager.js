/*!
 * lib/auth/authorizations-manager.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import jwt from "jsonwebtoken";
import validator from "validator";
import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import errors from "../errors.js";
import Logger from "../logger.js";

const keys = keysFile[network.key];

/**
 * @typedef {import('@tinyhttp/app').Request} Request
 * @typedef {import('@tinyhttp/app').Response} Response
 * @typedef {import('@tinyhttp/app').NextFunction} NextFunction
 */

/**
 * A singleton managing authorizations the API
 */
class AuthorizationsManager {
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
		this.accessTokenExpires = keys.auth.jwt.accessToken.expires;
		this.refreshTokenExpires = keys.auth.jwt.refreshToken.expires;
	}

	/**
	 * Middleware generating authorization token
	 * @param {Request} req - http request object
	 * @param {Response} res - http response object
	 * @param {NextFunction} next - callback
	 */
	generateAuthorizations(req, _res, next) {
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
	 * @param {Request} req - http request object
	 * @param {Response} res - http response object
	 * @param {NextFunction} next - callback
	 */
	refreshAuthorizations(req, _res, next) {
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
	 * @param {Request} req - http request object
	 * @param {Response} res - http response object
	 * @param {NextFunction} next - callback
	 */
	revokeAuthorizations(_req, _res, _next) {
		// Nothing to do (for now)
	}

	/**
	 * Middleware checking if user is authenticated
	 * @param {Request} req - http request object
	 * @param {Response} res - http response object
	 * @param {NextFunction} next - callback
	 */
	checkAuthentication(req, _res, next) {
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
	 * @param {Request} req - http request object
	 * @param {Response} res - http response object
	 * @param {NextFunction} next - callback
	 */
	checkHasAdminProfile(req, _res, next) {
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
	 * @param {string} token - json web token
	 * @returns {boolean} returns the decoded token if valid
	 * @throws {string} an exception otherwise
	 */
	isAuthenticated(token) {
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
	 * @param {Object} user - user's information
	 * @returns {string} returns a json web token
	 */
	_generateAccessToken(user) {
		// Builds claims
		const claims = {
			iss: this.ISS,
			type: this.TOKEN_TYPE_ACCESS,
			prf: user.profile,
		};

		// Builds and signs the access token
		return jwt.sign(claims, this._secret, {
			expiresIn: this.accessTokenExpires,
			algorithm: this.JWT_ALGO,
		});
	}

	/**
	 * Extract the access token from the http request
	 * @param {Request} req - http request object
	 * @returns {string | null} returns the json web token
	 */
	_extractAccessToken(req) {
		const token = this._extractBearerAuthorizationHeader(req);
		if (token) return token;

		if (req.body?.at && validator.isJWT(req.body.at)) return req.body.at;

		if (req.query?.at && validator.isJWT(req.query.at)) return req.query.at;

		return null;
	}

	/**
	 * Verify an access token
	 * @param {string} token - json web token
	 * @returns {Object} payload of the json web token
	 */
	_verifyAccessToken(token) {
		const payload = jwt.verify(token, this._secret, {
			algorithms: [this.JWT_ALGO],
		});

		if (payload.type !== this.TOKEN_TYPE_ACCESS) throw errors.auth.INVALID_JWT;

		return payload;
	}

	/**
	 * Generate an refresh token
	 * @param {Object} user - user's information
	 * @returns {string} returns a json web token
	 */
	_generateRefreshToken(user) {
		// Builds claims
		const claims = {
			iss: this.ISS,
			type: this.TOKEN_TYPE_REFRESH,
			prf: user.profile,
		};
		// Builds and signs the access token
		return jwt.sign(claims, this._secret, {
			expiresIn: this.refreshTokenExpires,
			algorithm: this.JWT_ALGO,
		});
	}

	/**
	 * Extract the refresh token from the http request
	 * @param {Request} req - http request object
	 * @returns {string | null} returns the json web token
	 */
	_extractRefreshToken(req) {
		const token = this._extractBearerAuthorizationHeader(req);
		if (token) return token;

		if (req.body?.rt && validator.isJWT(req.body.rt)) return req.body.rt;

		if (req.query?.rt && validator.isJWT(req.query.rt)) return req.query.rt;

		return null;
	}

	/**
	 * Verify a refresh token
	 * @param {string} token - json web token
	 * @returns {Object} payload of the json web token
	 */
	_verifyRefreshToken(token) {
		const payload = jwt.verify(token, this._secret, {
			algorithms: [this.JWT_ALGO],
		});

		if (payload.type !== this.TOKEN_TYPE_REFRESH) throw errors.auth.INVALID_JWT;

		return payload;
	}

	/**
	 * Extract a bearer JWT auth token
	 * from the Authorization HTTP header
	 * Returns null if it doesn't exist or is an onvalid JWT
	 * @param {Request} req - http request object
	 * @returns {string | null} returns the json web token
	 */
	_extractBearerAuthorizationHeader(req) {
		const authHeader = req.get("Authorization");

		if (authHeader?.startsWith("Bearer ")) {
			const token = authHeader.slice(7);
			if (validator.isJWT(token)) return token;
		}

		return null;
	}
}

export default new AuthorizationsManager();

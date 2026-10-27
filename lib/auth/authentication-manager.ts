/*!
 * lib/auth/authentication-manager.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import keysFile from "../../keys/index.js";
import network from "../bitcoin/network.js";
import db from "../db/mysql-db-wrapper.js";
import errors from "../errors.js";
import Logger from "../logger.js";
import authorzMgr from "./authorizations-manager.js";

const keys = keysFile[
	network.key as keyof typeof keysFile
] as unknown as DojoConfig;

/**
 * A singleton managing the authentication to the API
 */
class AuthenticationManager {
	/**
	 * Authenticate a user
	 */
	async authenticate(c: HttpContext, next: HttpNext) {
		const apiKey = c.get("body").apikey || c.req.query("apikey");

		const _adminKey = keys.auth.strategies.localApiKey.adminKey;
		const _apiKeys = keys.auth.strategies.localApiKey.apiKeys;

		const user = c.get("user") ?? {};
		c.set("user", user);

		if (apiKey === _adminKey) {
			// Check if received key is a valid api key
			Logger.info("Auth : Successful authentication with an admin key");
			user.authenticated = true;
			user.profile = authorzMgr.TOKEN_PROFILE_ADMIN;

			await next();
		} else if (
			_apiKeys.includes(apiKey as string) ||
			(await db.isApiKeyActive(apiKey))
		) {
			// Check if received key is a valid api key
			Logger.info("Auth : Successful authentication with an api key");
			user.authenticated = true;
			user.profile = authorzMgr.TOKEN_PROFILE_API;

			await next();
		} else {
			Logger.error(null, `Auth : Authentication failure (apikey=${apiKey})`);
			throw new Error(errors.auth.INVALID_API_KEY);
		}
	}
}

export default new AuthenticationManager();

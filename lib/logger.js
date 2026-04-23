/*!
 * lib/logger.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import util from "./util.js";

/**
 * Class providing static methods for logging
 */
const Logger = {
	/**
	 * Log a message in the console
	 * @param {string/object} msg
	 * @param {boolean=} json - true if msg is a json object, false otherwise
	 */
	info: (msg, json) => {
		const logEntry = Logger._formatLog("INFO", msg, json);
		console.log(logEntry);
	},

	/**
	 * Log an error message
	 * @param {object} e - error
	 * @param {string} msg - message associated to the error
	 */
	error: (e, msg) => {
		const logEntry = Logger._formatLog("ERROR", msg);
		console.error(logEntry);

		//const errorEntry = Logger._formatLog(e)
		if (e) {
			console.error(e);
		}
	},

	/**
	 * Format log entry
	 * @param {string} level - log level label
	 * @param {string/object} msg
	 * @param {boolean} json - true if msg is a json object, false otherwise
	 */
	_formatLog: (level, msg, json = false) => {
		const data = json ? JSON.stringify(msg, null, 2) : msg;

		const memUse = process.memoryUsage();
		const _mib = util.pad100(util.toMb(memUse.rss));

		const D = new Date();
		const y = D.getUTCFullYear();
		const m = util.pad10(D.getUTCMonth() + 1);
		const d = util.pad10(D.getUTCDate());
		const h = util.pad10(D.getUTCHours());
		const mn = util.pad10(D.getUTCMinutes());
		const s = util.pad10(D.getUTCSeconds());
		const _ms = util.pad100(D.getUTCMilliseconds());

		const parts = [
			y,
			"-",
			m,
			"-",
			d,
			"T",
			h,
			":",
			mn,
			":",
			s,
			"Z  ",
			level,
			"  ",
			data,
		];
		return parts.join("");
	},
};

export default Logger;

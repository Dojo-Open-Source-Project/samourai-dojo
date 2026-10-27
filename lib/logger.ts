/*!
 * lib/logger.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

import util from "./util.js";

/**
 * Class providing static methods for logging
 */
interface LoggerApi {
	info(msg?: string, json?: boolean): void;
	error(error?: unknown, msg?: string): void;
	_formatLog(level: string, msg: string, json?: boolean): string;
}

const Logger: LoggerApi = {
	/**
	 * Log a message in the console
	 */
	info: (msg?: string, json?: boolean) => {
		const logEntry = Logger._formatLog("INFO", msg, json);
		console.log(logEntry);
	},

	/**
	 * Log an error message
	 */
	error: (e?: unknown, msg?: string) => {
		const logEntry = Logger._formatLog("ERROR", msg);
		console.error(logEntry);

		//const errorEntry = Logger._formatLog(e)
		if (e) {
			console.error(e);
		}
	},

	/**
	 * Format log entry
	 */
	_formatLog: (level: string, msg: string, json = false) => {
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

		const parts: unknown[] = [
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

/*!
 * lib/util.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */

/**
 * @description Class providing utility functions as static methods
 */
type IteratorFn<T, R> = (item: T, iterable: T[]) => R | Promise<R>;

interface UtilApi {
	seriesCall<T, R>(list: T[], fn: IteratorFn<T, R>): Promise<R[]>;
	parallelCall<T, R>(list: T[], fn: IteratorFn<T, R>): Promise<R[]>;
	asyncPool<T, R>(
		poolLimit: number,
		iterable: T[],
		iteratorFn: (item: T, iterable: T[]) => R | Promise<R>,
	): Promise<R[]>;
	delay(ms: number): Promise<void>;
	splitList<T>(list: T[], limit: number): T[][];
	isHashStr(hash?: string): hash is string;
	is256Hash(hash: string): boolean;
	sum(arr: number[]): number;
	mean(arr: number[]): number;
	cmpAsc(a: number, b: number): number;
	cmpDesc(a: number, b: number): number;
	median(arr: number[], sorted?: boolean): number;
	mad(arr: number[], sorted?: boolean): number;
	quartiles(arr: number[], sorted?: boolean): number[];
	percentile(arr: number[], pct: number, sorted?: boolean): number;
	toMb(bytes: number): number;
	pad10(v: number): string;
	pad100(v: number): string;
	pad1000(v: number): string;
	leftPad(value: number, places: number, fill?: string): number | string;
	timePeriod(period: number, milliseconds?: boolean): string;
	range(start: number, stop: number, step?: number): number[];
	maxBy<T>(arr: T[], fn: (item: T) => number): T | null;
	unix(): number;
	MB: number;
}

const Util: UtilApi = {
	/**
	 * @description Serialize a series of asynchronous calls to a function over a list of objects
	 * @template T
	 * @template R
	 */
	seriesCall: async <T, R>(list: T[], fn: IteratorFn<T, R>) => {
		const results: R[] = [];

		for (const item of list) {
			results.push(await fn(item, list));
		}

		return results;
	},

	/**
	 * @description Execute parallel asynchronous calls to a function over a list of objects
	 * @template T
	 * @template R
	 */
	parallelCall: <T, R>(list: T[], fn: IteratorFn<T, R>) => {
		const operations = list.map((item: T) => {
			return fn(item, list);
		});
		return Promise.all(operations);
	},

	/**
	 * @template T
	 * @template R
	 * @callback IteratorFn
	 */

	/**
	 * @description Execute asynchronous call in a pool that preserves order of items
	 * @template T
	 * @template R
	 */
	asyncPool: async <T, R>(
		poolLimit: number,
		iterable: T[],
		iteratorFn: IteratorFn<T, R>,
	) => {
		const ret: Promise<R>[] = [];
		const executing = new Set<Promise<R>>();

		for (const item of iterable) {
			const p = Promise.resolve().then(() => iteratorFn(item, iterable));
			ret.push(p);
			executing.add(p);
			const clean = () => executing.delete(p);
			p.then(clean).catch(clean);

			if (executing.size >= poolLimit) {
				await Promise.race(executing);
			}
		}

		return Promise.all(ret);
	},

	/**
	 * @description Delay the call to a function
	 */
	delay: (ms: number) => {
		return new Promise<void>((resolve) => {
			setTimeout(() => resolve(), ms);
		});
	},

	/**
	 * @description Splits a list into a list of lists each with maximum length LIMIT
	 * @template T
	 */
	splitList: <T>(list: T[], limit: number) => {
		const lists: T[][] = [];
		for (let i = 0; i < list.length; i += limit)
			lists.push(list.slice(i, i + limit));
		return lists;
	},

	/**
	 * @description Check if a string is a valid hex value
	 */
	isHashStr: (hash?: string): hash is string => {
		const hexRegExp = new RegExp(/^[\da-f]*$/, "i");
		return typeof hash === "string" ? hexRegExp.test(hash) : false;
	},

	/**
	 * @description Check if a string is a well formed 256 bits hash
	 */
	is256Hash: (hash?: string) => {
		return Util.isHashStr(hash) && hash.length === 64;
	},

	/**
	 * @description Sum an array of values
	 */
	sum: (arr: number[]) => {
		return arr.reduce((memo: number, val: number) => {
			return memo + val;
		}, 0);
	},

	/**
	 * @description Mean of an array of values
	 */
	mean: (arr: number[]) => {
		if (arr.length === 0) return Number.NaN;
		return Util.sum(arr) / arr.length;
	},

	/**
	 * @description Compare 2 values (asc order)
	 */
	cmpAsc: (a: number, b: number) => {
		return a - b;
	},

	/**
	 * @description Compare 2 values (desc order)
	 */
	cmpDesc: (a: number, b: number) => {
		return b - a;
	},

	/**
	 * @description Median of an array of values
	 */
	median: (arr: number[], sorted = false) => {
		if (arr.length === 0) return Number.NaN;
		if (arr.length === 1) return arr[0];

		if (!sorted) arr.sort(Util.cmpAsc);

		const midpoint = Math.floor(arr.length / 2);

		return arr.length % 2
			? arr[midpoint]
			: (arr[midpoint - 1] + arr[midpoint]) / 2;
	},

	/**
	 * @description Median Absolute Deviation of an array of values
	 */
	mad: (arr: number[], sorted = false) => {
		const med = Util.median(arr, sorted);
		// Deviations from the median
		const dev: number[] = [];
		for (const val of arr) dev.push(Math.abs(val - med));
		return Util.median(dev);
	},

	/**
	 * @description Quartiles of an array of values
	 */
	quartiles: (arr: number[], sorted = false) => {
		const q: number[] = [Number.NaN, Number.NaN, Number.NaN];

		if (arr.length < 3) return q;

		if (!sorted) arr.sort(Util.cmpAsc);

		// Set median
		q[1] = Util.median(arr, true);

		const midpoint = Math.floor(arr.length / 2);

		if (arr.length % 2) {
			// Odd-length array
			const mod4 = arr.length % 4;
			const n = Math.floor(arr.length / 4);

			if (mod4 === 1) {
				q[0] = (arr[n - 1] + 3 * arr[n]) / 4;
				q[2] = (3 * arr[3 * n] + arr[3 * n + 1]) / 4;
			} else if (mod4 === 3) {
				q[0] = (3 * arr[n] + arr[n + 1]) / 4;
				q[2] = (arr[3 * n + 1] + 3 * arr[3 * n + 2]) / 4;
			}
		} else {
			// Even-length array. Slices are already sorted
			q[0] = Util.median(arr.slice(0, midpoint), true);
			q[2] = Util.median(arr.slice(midpoint), true);
		}

		return q;
	},

	/**
	 * @description Obtain the value of the PCT-th percentile, where PCT on [0,100]
	 */
	percentile: (arr: number[], pct: number, sorted = false) => {
		if (arr.length < 2) return Number.NaN;

		if (!sorted) arr.sort(Util.cmpAsc);

		const N = arr.length;
		const p = pct / 100;

		let x: number; // target rank

		if (p <= 1 / (N + 1)) {
			x = 1;
		} else if (p < N / (N + 1)) {
			x = p * (N + 1);
		} else {
			x = N;
		}

		// "Floor-x"
		const fx = Math.floor(x) - 1;

		// "Mod-x"
		const mx = x % 1;

		return fx + 1 >= N ? arr[fx] : arr[fx] + mx * (arr[fx + 1] - arr[fx]);
	},

	/**
	 * @description Convert bytes to MB
	 */
	toMb: (bytes: number) => {
		return Number((bytes / Util.MB).toFixed(0));
	},

	/**
	 * @description Convert a date to a unix timestamp
	 */
	unix: () => {
		return Math.trunc(Date.now() / 1000);
	},

	/**
	 * @description Convert a value to a padded string (10 chars)
	 */
	pad10: (v: number) => {
		return v < 10 ? `0${v}` : `${v}`;
	},

	/**
	 * @description Convert a value to a padded string (100 chars)
	 */
	pad100: (v: number) => {
		if (v < 10) return `00${v}`;
		if (v < 100) return `0${v}`;
		return `${v}`;
	},

	/**
	 * @description Convert a value to a padded string (1000 chars)
	 */
	pad1000: (v: number) => {
		if (v < 10) return `000${v}`;
		if (v < 100) return `00${v}`;
		if (v < 1000) return `0${v}`;
		return `${v}`;
	},

	/**
	 * @description Left pad
	 */
	leftPad: (number: number, places: number, fill = " ") => {
		number = Math.round(number);
		places = Math.round(places);

		if (number < 0) return number;

		const mag = number > 0 ? Math.floor(Math.log10(number)) + 1 : 1;
		const parts: Array<number | string> = [];

		for (let i = 0; i < places - mag; i++) {
			parts.push(fill);
		}

		parts.push(number);
		return parts.join("");
	},

	/**
	 * @description Display a time period, in seconds, as DDD:HH:MM:SS[.MS]
	 */
	timePeriod: (period: number, milliseconds = false) => {
		const whole = Math.floor(period);
		const ms = 1000 * (period - whole);
		const s = whole % 60;
		const m = whole >= 60 ? Math.floor(whole / 60) % 60 : 0;
		const h = whole >= 3600 ? Math.floor(whole / 3600) % 24 : 0;
		const d = whole >= 86400 ? Math.floor(whole / 86400) : 0;

		const parts: string[] = [Util.pad10(h), Util.pad10(m), Util.pad10(s)];

		if (d > 0) parts.splice(0, 0, Util.pad100(d));

		const str = parts.join(":");

		return milliseconds ? `${str}.${Util.pad100(ms)}` : str;
	},

	/**
	 * @description Generate array of sequential numbers from start to stop
	 */
	range: (start: number, stop: number, step = 1) => {
		return Array.from({ length: Math.ceil((stop - start) / step) })
			.fill(start)
			.map((x, y) => Number(x) + y * step);
	},
	/**
	 * @description Get item from an array that contains largest value defined by the callback function
	 * @template T
	 */
	maxBy: <T>(arr: T[], fn: (item: T) => number) => {
		return arr.reduce<T | null>((prev, current) => {
			if (!prev) return current;
			return fn(current) > fn(prev) ? current : prev;
		}, null);
	},
	/**
	 * 1Mb in bytes
	 */
	MB: 1024 * 1024,
};

export default Util;

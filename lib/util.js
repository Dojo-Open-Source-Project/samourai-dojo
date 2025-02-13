/*!
 * lib/util.js
 * Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.
 */


/**
 * @description Class providing utility functions as static methods
 */
const Util = {

    /**
     * @description Serialize a series of asynchronous calls to a function over a list of objects
     * @template T
     * @template R
     * @param {Array<T>} list
     * @param {IteratorFn} fn
     * @returns {Promise<Array<R>>}
     */
    seriesCall: async (list, fn) => {
        const results = []

        for (const item of list) {
            results.push(await fn(item, list))
        }

        return results
    },

    /**
     * @description Execute parallel asynchronous calls to a function over a list of objects
     * @template T
     * @template R
     * @param {Array<T>} list
     * @param {IteratorFn} fn
     * @returns {Promise<Array<R>>}
     */
    parallelCall: (list, fn) => {
        const operations = list.map((item) => {
            return fn(item, list)
        })
        return Promise.all(operations)
    },

    /**
     * @template T
     * @template R
     * @callback IteratorFn
     * @param  {T} item - Value of array element
     * @param  {Iterable<T>} iterable - Array of elements
     * @returns {Promise<R>}
     */

    /**
     * @description Execute asynchronous call in a pool that preserves order of items
     * @template T
     * @template R
     * @param {number} poolLimit - max number of promises running concurrently
     * @param {Iterable<T>} iterable - array of items
     * @param {IteratorFn<T, R>} iteratorFn
     * @returns {Promise<R[]>}
     */
    asyncPool: async (poolLimit, iterable, iteratorFn) => {
        const ret = []
        const executing = new Set()

        for (const item of iterable) {
            const p = Promise.resolve().then(() => iteratorFn(item, iterable))
            ret.push(p)
            executing.add(p)
            // eslint-disable-next-line unicorn/consistent-function-scoping
            const clean = () => executing.delete(p)
            p.then(clean).catch(clean)

            if (executing.size >= poolLimit) {
                await Promise.race(executing)
            }
        }

        return Promise.all(ret)
    },

    /**
     * @description Delay the call to a function
     * @param {number} ms
     * @returns {Promise<void>}
     */
    delay: (ms) => {
        return new Promise(resolve => {
            setTimeout(() => resolve(), ms)
        })
    },

    /**
     * @description Splits a list into a list of lists each with maximum length LIMIT
     * @template T
     * @param {Array<T>} list
     * @param {number} limit
     * @returns {Array<Array<T>>}
     */
    splitList: (list, limit) => {
        const lists = []
        for (let i = 0; i < list.length; i += limit)
            lists.push(list.slice(i, i + limit))
        return lists
    },

    /**
     * @description Check if a string is a valid hex value
     * @param {string} hash
     * @returns {boolean}
     */
    isHashStr: (hash) => {
        const hexRegExp = new RegExp(/^[\da-f]*$/, 'i')
        return (typeof hash === 'string') ? hexRegExp.test(hash): false
    },

    /**
     * @description Check if a string is a well formed 256 bits hash
     * @param {string} hash
     * @returns {boolean}
     */
    is256Hash: (hash) => {
        return Util.isHashStr(hash) && hash.length === 64
    },


    /**
     * @description Sum an array of values
     * @param {Array<number>} arr
     * @returns {number}
     */
    sum: (arr) => {
        return arr.reduce((memo, val) => {
            return memo + val
        }, 0)
    },

    /**
     * @description Mean of an array of values
     * @param {Array<number>} arr
     * @returns {number}
     */
    mean: (arr) => {
        if (arr.length === 0)
            return Number.NaN
        return Util.sum(arr) / arr.length
    },

    /**
     * @description Compare 2 values (asc order)
     * @param {number} a
     * @param {number} b
     * @returns {number}
     */
    cmpAsc: (a, b) => {
        return a - b
    },

    /**
     * @description Compare 2 values (desc order)
     * @param {number} a
     * @param {number} b
     * @returns {number}
     */
    cmpDesc: (a, b) => {
        return b - a
    },

    /**
     * @description Median of an array of values
     * @param {Array<number>} arr
     * @param {boolean=} sorted
     * @returns {number}
     */
    median: (arr, sorted) => {
        if (arr.length === 0) return Number.NaN
        if (arr.length === 1) return arr[0]

        if (!sorted)
            arr.sort(Util.cmpAsc)

        const midpoint = Math.floor(arr.length / 2)

        return arr.length % 2 ? arr[midpoint] : (arr[midpoint - 1] + arr[midpoint]) / 2
    },

    /**
     * @description Median Absolute Deviation of an array of values
     * @param {Array<number>} arr
     * @param {boolean=} sorted
     * @returns {number}
     */
    mad: (arr, sorted) => {
        const med = Util.median(arr, sorted)
        // Deviations from the median
        const dev = []
        for (let val of arr)
            dev.push(Math.abs(val - med))
        return Util.median(dev)
    },

    /**
     * @description Quartiles of an array of values
     * @param {Array<number>} arr
     * @param {boolean=} sorted
     * @returns {Array<number>}
     */
    quartiles: (arr, sorted) => {
        const q = [Number.NaN, Number.NaN, Number.NaN]

        if (arr.length < 3) return q

        if (!sorted)
            arr.sort(Util.cmpAsc)

        // Set median
        q[1] = Util.median(arr, true)

        const midpoint = Math.floor(arr.length / 2)

        if (arr.length % 2) {
            // Odd-length array
            const mod4 = arr.length % 4
            const n = Math.floor(arr.length / 4)

            if (mod4 === 1) {
                q[0] = (arr[n - 1] + 3 * arr[n]) / 4
                q[2] = (3 * arr[3 * n] + arr[3 * n + 1]) / 4
            } else if (mod4 === 3) {
                q[0] = (3 * arr[n] + arr[n + 1]) / 4
                q[2] = (arr[3 * n + 1] + 3 * arr[3 * n + 2]) / 4
            }

        } else {
            // Even-length array. Slices are already sorted
            q[0] = Util.median(arr.slice(0, midpoint), true)
            q[2] = Util.median(arr.slice(midpoint), true)
        }

        return q
    },

    /**
     * @description Obtain the value of the PCT-th percentile, where PCT on [0,100]
     * @param {Array<number>} arr
     * @param {number} pct
     * @param {boolean=} sorted
     * @returns {number}
     */
    percentile: (arr, pct, sorted) => {
        if (arr.length < 2) return Number.NaN

        if (!sorted)
            arr.sort(Util.cmpAsc)

        const N = arr.length
        const p = pct / 100

        let x // target rank

        if (p <= 1 / (N + 1)) {
            x = 1
        } else if (p < N / (N + 1)) {
            x = p * (N + 1)
        } else {
            x = N
        }

        // "Floor-x"
        const fx = Math.floor(x) - 1

        // "Mod-x"
        const mx = x % 1

        return fx + 1 >= N ? arr[fx] : arr[fx] + mx * (arr[fx + 1] - arr[fx])
    },

    /**
     * @description Convert bytes to MB
     * @param {number} bytes
     * @returns {number}
     */
    toMb: (bytes) => {
        return Number((bytes / Util.MB).toFixed(0))
    },

    /**
     * @description Convert a date to a unix timestamp
     * @returns {number}
     */
    unix: () => {
        return Math.trunc(Date.now() / 1000)
    },

    /**
     * @description Convert a value to a padded string (10 chars)
     * @param {number} v
     * @returns {string}
     */
    pad10: (v) => {
        return (v < 10) ? `0${v}` : `${v}`
    },

    /**
     * @description Convert a value to a padded string (100 chars)
     * @param {number} v
     * @returns {string}
     */
    pad100: (v) => {
        if (v < 10) return `00${v}`
        if (v < 100) return `0${v}`
        return `${v}`
    },

    /**
     * @description Convert a value to a padded string (1000 chars)
     * @param {number} v
     * @returns {string}
     */
    pad1000: (v) => {
        if (v < 10) return `000${v}`
        if (v < 100) return `00${v}`
        if (v < 1000) return `0${v}`
        return `${v}`
    },

    /**
     * @description Left pad
     * @param {number} number
     * @param {number} places
     * @param {string=} fill
     * @returns {string}
     */
    leftPad: (number, places, fill) => {
        number = Math.round(number)
        places = Math.round(places)
        fill = fill || ' '

        if (number < 0) return number

        const mag = (number > 0) ? (Math.floor(Math.log10(number)) + 1) : 1
        const parts = []

        for (let i = 0; i < (places - mag); i++) {
            parts.push(fill)
        }

        parts.push(number)
        return parts.join('')
    },

    /**
     * @description Display a time period, in seconds, as DDD:HH:MM:SS[.MS]
     * @param {number} period
     * @param {boolean} milliseconds
     * @returns {string}
     */
    timePeriod: (period, milliseconds) => {
        const whole = Math.floor(period)
        const ms = 1000 * (period - whole)
        const s = whole % 60
        const m = (whole >= 60) ? Math.floor(whole / 60) % 60 : 0
        const h = (whole >= 3600) ? Math.floor(whole / 3600) % 24 : 0
        const d = (whole >= 86400) ? Math.floor(whole / 86400) : 0

        const parts = [Util.pad10(h), Util.pad10(m), Util.pad10(s)]

        if (d > 0)
            parts.splice(0, 0, Util.pad100(d))

        const str = parts.join(':')

        return milliseconds ? `${str}.${Util.pad100(ms)}` : str
    },

    /**
     * @description Generate array of sequential numbers from start to stop
     * @param {number} start
     * @param {number} stop
     * @param {number=} step
     * @returns {number[]}
     */
    range: (start, stop, step = 1) => {
        return Array.from({ length: Math.ceil((stop - start) / step) })
            .fill(start)
            .map((x, y) => x + y * step)
    },
    /**
     * @description Get item from an array that contains largest value defined by the callback function
     * @template T
     * @param {T[]} arr
     * @param {(item: T) => number} fn
     * @returns {T | null}
     */
    maxBy: (arr, fn) => {
        return arr.reduce((prev, current) => {
            if (!prev) return current
            return fn(current) > fn(prev) ? current : prev
        }, null)
    },
    /**
     * 1Mb in bytes
     */
    MB: 1024 * 1024,
}


export default Util

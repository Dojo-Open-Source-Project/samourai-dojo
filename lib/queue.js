/**
 * @template T
 * @template R
 * @callback ProcessingFn
 * @param {T} item - Value of array element
 * @returns {Promise<R>}
 */

export class FifoQueue {
    /**
     * @param {ProcessingFn<T, R>} processingFn - callback function to process queue items
     * @param {number=} highWaterMark - max number of unprocessed items upon which should other tasks await
     */
    constructor(processingFn, highWaterMark) {
        if (!processingFn) throw new Error('No processing function was provided as a callback')

        /**
         * @private
         * @type {ProcessingFn<T>}
         */
        this.processingFn = processingFn

        /**
         * @private
         * @type {number}
         */
        this.highWaterMark = highWaterMark || Number.POSITIVE_INFINITY

        /**
         * @type {boolean}
         */
        this.isProcessing = false

        /**
         * @type {boolean}
         */
        this.isWaterMarkExceeded = false

        /**
         * @private
         * @type {Set<() => void>}
         */
        this.finishedEmitterQueue = new Set()

        /**
         * @private
         * @type {Set<() => void>}
         */
        this.waterMarkQueue = new Set()

        /**
         * @private
         * @type {T[]}
         */
        this.items = []
    }

    /**
     * Appends new elements to the end of an array, and returns the new length of the array.
     * @param  {T} items - New elements to add to the array.
     * @returns {number}
     */
    push(...items) {
        const len = this.items.push(...items)
        this.onPush(len)

        return len
    }

    /**
     * @private
     * @param {number} len - current queue length
     * @returns {Promise<void>}
     */
    async onPush(len) {
        this.isWaterMarkExceeded = len >= this.highWaterMark

        if (this.isProcessing === false) {
            this.isProcessing = true

            while (this.items.length > 0) {
                const item = this.items.shift()

                await this.processingFn(item)
                this.checkWaterMark()
            }

            this.onFinished()
        }
    }

    /**
     * @private
     */
    onFinished() {
        this.isProcessing = false
        for (const resolver of this.finishedEmitterQueue.values()) {
            resolver()
        }
        this.finishedEmitterQueue.clear()
    }

    /**
     * @private
     */
    checkWaterMark() {
        if (this.items.length < this.highWaterMark) {
            this.isWaterMarkExceeded = false

            for (const resolver of this.waterMarkQueue.values()) {
                resolver()
            }
            this.waterMarkQueue.clear()
        }
    }

    /**
     * Resolves when queue is done processing
     * @returns {Promise<void>}
     */
    waitOnFinished() {
        if (!this.isProcessing) return Promise.resolve()

        return new Promise((resolve) => {
            this.finishedEmitterQueue.add(resolve)
        })
    }

    /**
     * Resolves when process queue is lower than specified high watermark
     * @returns {Promise<void>}
     */
    waitOnWaterMark() {
        if (!this.isWaterMarkExceeded) return Promise.resolve()

        return new Promise((resolve) => {
            this.waterMarkQueue.add(resolve)
        })
    }
}

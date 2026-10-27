/**
 * @template T
 * @template R
 * @callback ProcessingFn
 */

type ProcessingFn<T, R> = (item: T) => Promise<R> | R;

export class FifoQueue<T, R> {
	declare processingFn: ProcessingFn<T, R>;
	declare highWaterMark: number;
	declare isProcessing: boolean;
	declare isWaterMarkExceeded: boolean;
	declare finishedEmitterQueue: Set<() => void>;
	declare waterMarkQueue: Set<() => void>;
	declare items: T[];

	constructor(processingFn: ProcessingFn<T, R>, highWaterMark?: number) {
		if (!processingFn)
			throw new Error("No processing function was provided as a callback");

		/**
		 * @private
		 * @type {ProcessingFn<T>}
		 */
		this.processingFn = processingFn;

		/**
		 * @private
		 * @type {number}
		 */
		this.highWaterMark = highWaterMark || Number.POSITIVE_INFINITY;

		/**
		 * @type {boolean}
		 */
		this.isProcessing = false;

		/**
		 * @type {boolean}
		 */
		this.isWaterMarkExceeded = false;

		/**
		 * @private
		 * @type {Set<() => void>}
		 */
		this.finishedEmitterQueue = new Set();

		/**
		 * @private
		 * @type {Set<() => void>}
		 */
		this.waterMarkQueue = new Set();

		/**
		 * @private
		 * @type {T[]}
		 */
		this.items = [];
	}

	/**
	 * Appends new elements to the end of an array, and returns the new length of the array.
	 */
	push(...items: T[]) {
		const len = this.items.push(...items);
		this.onPush(len);

		return len;
	}

	/**
	 * @private
	 */
	async onPush(len: number) {
		this.isWaterMarkExceeded = len >= this.highWaterMark;

		if (this.isProcessing === false) {
			this.isProcessing = true;

			while (this.items.length > 0) {
				const item = this.items.shift();
				if (item === undefined) continue;

				await this.processingFn(item);
				this.checkWaterMark();
			}

			this.onFinished();
		}
	}

	/**
	 * @private
	 */
	onFinished() {
		this.isProcessing = false;
		for (const resolver of this.finishedEmitterQueue.values()) {
			resolver();
		}
		this.finishedEmitterQueue.clear();
	}

	/**
	 * @private
	 */
	checkWaterMark() {
		if (this.items.length < this.highWaterMark) {
			this.isWaterMarkExceeded = false;

			for (const resolver of this.waterMarkQueue.values()) {
				resolver();
			}
			this.waterMarkQueue.clear();
		}
	}

	/**
	 * Resolves when queue is done processing
	 */
	waitOnFinished() {
		if (!this.isProcessing) return Promise.resolve();

		return new Promise<void>((resolve) => {
			this.finishedEmitterQueue.add(resolve);
		});
	}

	/**
	 * Resolves when process queue is lower than specified high watermark
	 */
	waitOnWaterMark() {
		if (!this.isWaterMarkExceeded) return Promise.resolve();

		return new Promise<void>((resolve) => {
			this.waterMarkQueue.add(resolve);
		});
	}
}

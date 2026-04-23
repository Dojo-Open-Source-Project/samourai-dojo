import assert from "node:assert";

import util from "../../lib/util.js";

describe("Util", () => {
	describe("range()", () => {
		it("should return a correct range of values with default step", () => {
			const expected = [3, 4, 5, 6, 7, 8, 9, 10, 11];

			const result = util.range(3, 12);

			assert.deepStrictEqual(result, expected);
		});

		it("should return a correct range of values with step=3", () => {
			const expected = [3, 6, 9, 12];

			const result = util.range(3, 13, 3);

			assert.deepStrictEqual(result, expected);
		});
	});

	describe("maxBy()", () => {
		it("should return a correct item by max value", () => {
			const objects = [
				{ n: 1 },
				{ n: 2 },
				{ n: 4 },
				{ n: 8 },
				{ n: 5 },
				{ n: 3 },
			];

			const result = util.maxBy(objects, (obj) => obj.n);

			assert.deepStrictEqual(result, objects[3]);
		});

		it("should return null when provided array is empty", () => {
			const objects = [];

			const result = util.maxBy(objects, (obj) => obj.n);

			assert.strictEqual(result, null);
		});
	});
});

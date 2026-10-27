import { expectTypeOf, it } from "vitest";
import type {
	AddressRow,
	DbWriteResult,
	ScheduledTransactionRow,
} from "../../../lib/db/mysql-db-types.js";
import db from "../../../lib/db/mysql-db-wrapper.js";

it("exposes selected columns separately from write metadata", () => {
	expectTypeOf(db.getAddresses).returns.resolves.toEqualTypeOf<AddressRow[]>();
	expectTypeOf(db.getScheduledTransactions).returns.resolves.toEqualTypeOf<
		ScheduledTransactionRow[]
	>();
	expectTypeOf(db.createApiKey).returns.resolves.toEqualTypeOf<DbWriteResult>();
	expectTypeOf(db.getScheduledTransactions).returns.resolves.not.toHaveProperty(
		"insertId",
	);
	expectTypeOf(db.createApiKey).returns.resolves.not.toHaveProperty("length");
	expectTypeOf(db.getOutputIds).returns.resolves.items.not.toHaveProperty(
		"outAmount",
	);
	expectTypeOf(db.getHDAccount).returns.resolves.not.toHaveProperty("addrID");
	expectTypeOf(db._query).returns.resolves.toBeUnknown();
});

it("retains empty-input return values for bulk writes", () => {
	expectTypeOf(db.addAddresses).returns.resolves.toEqualTypeOf<
		[] | DbWriteResult
	>();
	expectTypeOf(db.deleteTransactionsByID).returns.resolves.toEqualTypeOf<
		[] | DbWriteResult
	>();
});

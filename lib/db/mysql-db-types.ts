/** Rows returned by SELECT * from the corresponding tables. */
export interface AddressRow {
	addrID: number;
	addrAddress: string | null;
}

export interface HdAccountRow {
	hdID: number;
	hdXpub: string | null;
	hdCreated: number;
	hdType: number;
}

export interface TransactionRow {
	txnID: number;
	txnTxid: string | null;
	txnCreated: number;
	txnVersion: number;
	txnLocktime: number;
	blockID: number | null;
}

export interface InputRow {
	inID: number;
	outID: number;
	txnID: number;
	inIndex: number;
	inSequence: number;
}

export interface BlockRow {
	blockID: number;
	blockHash: string;
	blockParent: number | null;
	blockHeight: number;
	blockTime: number;
}

export interface ScheduledTransactionRow {
	schID: number;
	schTxid: string;
	schCreated: number;
	schRaw: string;
	schParentID: number | null;
	schParentTxid: string | null;
	schDelay: number;
	schTrigger: number;
}

export interface ApiKeyRow {
	apikeyID: number;
	label: string;
	apikey: string;
	active: number | null;
	createdAt: Date | null;
	expiresAt: Date;
}

/** Metadata returned by INSERT, UPDATE and DELETE, never a row array. */
export interface DbWriteResult {
	insertId: number;
	affectedRows: number;
	warningStatus: number;
}

/** Address ownership from LEFT JOINs, including unowned addresses. */
export interface AddressOwnershipRow extends AddressRow {
	hdID: number | null;
	hdXpub: string | null;
	hdType: number | null;
	hdAddrChain: number | null;
	hdAddrIndex: number | null;
}

export interface TransactionPageRow {
	txnID: number;
	txnTxid: string | null;
	txnVersion: number;
	txnLocktime: number;
	blockHeight: number | null;
	time: number;
}

/** Columns shared by transaction detail queries, including nullable joins. */
interface TransactionDetailRow {
	txnTxid: string | null;
	txnCreated: number;
	txnVersion: number;
	txnLocktime: number;
	blockHeight: number | null;
	blockTime: number | null;
	outID: number;
	outIndex: number;
	outAmount: number;
	outScript: string;
	addrAddress: string | null;
	hdAddrChain: number | null;
	hdAddrIndex: number | null;
	hdXpub: string | null;
}

export interface TransactionOutputRow extends TransactionDetailRow {
	txnID: number;
}

export interface TransactionInputRow extends TransactionDetailRow {
	prevOutTxid: string | null;
	inIndex: number;
	inSequence: number;
}

/** A UNION row is either an input or an output; the other fields are NULL. */
export interface TransactionUtxoRow {
	txnID: number;
	outIndex: number | null;
	outAmount: number | null;
	outAddress: string | null;
	inIndex: number | null;
	inSequence: number | null;
	inOutTxid: string | null;
	inOutIndex: number | null;
	inOutAmount: number | null;
	inOutAddress: string | null;
	hdAddrChain: number | null;
	hdAddrIndex: number | null;
	hdXpub: string | null;
}

export interface UnspentOutputRow {
	txnTxid: string | null;
	txnVersion: number;
	txnLocktime: number;
	blockHeight: number | null;
	outIndex: number;
	outAmount: number;
	outScript: string;
	addrAddress: string | null;
}

export interface HdUnspentOutputRow extends UnspentOutputRow {
	hdAddrChain: number;
	hdAddrIndex: number;
}

export interface OutputIdRow {
	outID: number;
	txnTxid: string | null;
	outIndex: number;
}

export interface OutputSpendRow extends OutputIdRow {
	addrAddress: string | null;
	outAmount: number;
	spendingTxnID: number | null;
}

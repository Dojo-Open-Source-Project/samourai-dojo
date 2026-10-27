import { accessToken, clearTokens } from "./auth";

declare const __DOJO_ADMIN_API_BASE__: string;
const apiBase = __DOJO_ADMIN_API_BASE__;

export type Explorer = { type?: string; url?: string };
export type Pairing = {
	pairing?: {
		url?: string;
		baseUri?: string;
		apikey?: string;
		version?: string;
	};
	explorer?: Explorer;
	[key: string]: unknown;
};
export type TxSummary = {
	hash: string;
	time: number;
	result: number | string;
	block_height?: number | string | null;
};
export type Utxo = {
	tx_hash: string;
	tx_output_n: number;
	value: number | string;
	addr?: string;
	confirmations: number;
};
export type Wallet = { txs?: TxSummary[]; unspent_outputs?: Utxo[] };
export type Address = {
	tracked?: boolean;
	type?: string;
	segwit?: boolean | null;
	xpub?: string | null;
	path?: string | null;
	n_tx?: number | string;
	balance?: number | string;
};
export type Xpub = Address & {
	unused?: { external: number; internal: number };
	derived?: { external: number; internal: number };
	derivation?: string | null;
	account?: number | string;
	depth?: number | string;
	created?: string | number | null;
};
export type Tx = {
	txid?: string;
	hash?: string;
	size?: number;
	vsize?: number;
	version?: number | string;
	locktime?: number | string;
	created?: number;
	fees?: number | string;
	vfeerate?: number;
	block?: { height: number };
	inputs?: unknown[];
	outputs?: { value?: number | string }[];
};
export type ApiKey = {
	apikeyID: number;
	label: string;
	apikey: string;
	active: boolean;
	createdAt: string;
	expiresAt: string;
};
export type Status = {
	uptime?: number;
	blocks?: number;
	indexer?: { maxHeight?: number; type?: string; url?: string };
};
export type PushStatus = {
	data: {
		uptime: number;
		bitcoind: {
			blocks: number;
			version: number;
			testnet: boolean;
			conn: number;
			relayfee: number;
		};
		push: { count: number | string; amount: number | string };
	};
};
export type Scheduled = {
	schID: number;
	schTxid: string;
	schTrigger: number;
	schCreated: number;
	schParentTxid?: string | null;
	schRaw: string;
};
export type AuthResponse = {
	authorizations: { access_token: string; refresh_token: string };
};

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}
function path(part: string) {
	return `${apiBase}${part}`;
}
function encoded(value: string) {
	return encodeURIComponent(value);
}
function params(values: Record<string, string | number | boolean | undefined>) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(values))
		if (value !== undefined) search.set(key, String(value));
	const result = search.toString();
	return result ? `?${result}` : "";
}
async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	const token = accessToken();
	if (token) headers.set("Authorization", `Bearer ${token}`);
	const response = await fetch(url, { ...init, headers });
	const body: unknown = await response.json().catch(() => ({}));
	if (!response.ok) {
		const error =
			body && typeof body === "object" && "error" in body
				? String(body.error)
				: response.statusText;
		if (
			token &&
			(response.status === 401 ||
				error === "Invalid JSON Web Token" ||
				error === "Missing JSON Web Token")
		) {
			clearTokens();
			window.dispatchEvent(new Event("dojo:unauthorized"));
		}
		throw new ApiError(error || `HTTP ${response.status}`, response.status);
	}
	return body as T;
}
function postForm<T>(
	url: string,
	data: Record<string, string | number | boolean | undefined>,
) {
	return request<T>(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: params(data).slice(1),
	});
}
function json<T>(url: string, method: "POST" | "PATCH", data: unknown) {
	return request<T>(url, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
}
export const api = {
	login: (key: string) =>
		postForm<AuthResponse>(path("/auth/login"), { apikey: key }),
	refresh: (token: string) =>
		postForm<AuthResponse>(path("/auth/refresh"), { rt: token }),
	auth47Uri: (signal?: AbortSignal) =>
		request<{ data: { nonce: string; uri: string; paymentCode?: string } }>(
			path("/auth/auth47/uri"),
			{ signal },
		),
	auth47Status: (nonce: string, signal?: AbortSignal) =>
		request<Partial<AuthResponse>>(
			path(`/auth/auth47/status/${encoded(nonce)}`),
			{ signal },
		),
	status: (signal?: AbortSignal) =>
		request<Status>(path("/status"), { signal }),
	pushStatus: (signal?: AbortSignal) =>
		request<PushStatus>(path("/pushtx/status"), { signal }),
	schedule: (signal?: AbortSignal) =>
		request<{ data: { nbTxs: number; txs: Scheduled[] } }>(
			path("/pushtx/status/schedule"),
			{ signal },
		),
	pairing: (signal?: AbortSignal) =>
		request<Pairing>(path("/support/pairing"), { signal }),
	apiKeys: (signal?: AbortSignal) =>
		request<ApiKey[]>(path("/support/apikeys"), { signal }),
	createKey: (data: { label: string; expiresAt: Date }) =>
		json(path("/support/apikey"), "POST", data),
	updateKey: (
		key: string,
		data: { label: string; expiresAt: Date; active: boolean },
	) => json(path(`/support/apikey/${encoded(key)}`), "PATCH", data),
	deleteKey: (key: string) =>
		request(path(`/support/apikey/${encoded(key)}`), { method: "DELETE" }),
	address: (address: string, signal?: AbortSignal) =>
		request<Address>(path(`/support/address/${encoded(address)}/info`), {
			signal,
		}),
	addressRescan: (address: string) =>
		request(path(`/support/address/${encoded(address)}/rescan`)),
	xpub: (xpub: string, signal?: AbortSignal) =>
		request<Xpub>(path(`/support/xpub/${encoded(xpub)}/info`), { signal }),
	xpubImport: (data: {
		xpub: string;
		type: string;
		force: boolean;
		segwit?: string;
	}) => postForm(path("/xpub"), data),
	xpubRescan: (xpub: string, gap: number, startidx: number) =>
		request(
			path(`/support/xpub/${encoded(xpub)}/rescan${params({ gap, startidx })}`),
		),
	xpubRescanStatus: (xpub: string, signal?: AbortSignal) =>
		request<{
			data: { import_in_progress: boolean; status: string; hits: number };
		}>(path(`/xpub/${encoded(xpub)}/import/status`), { signal }),
	xpubDelete: (xpub: string) =>
		request(path(`/support/xpub/${encoded(xpub)}/delete`)),
	wallet: (active: string, signal?: AbortSignal) =>
		request<Wallet>(path(`/wallet${params({ active })}`), { signal }),
	tx: (txid: string, signal?: AbortSignal) =>
		request<Tx>(path(`/tx/${encoded(txid)}?fees=1`), { signal }),
	txHex: (txid: string, signal?: AbortSignal) =>
		request<{ data: string }>(path(`/tx/${encoded(txid)}/hex`), { signal }),
	txs: (active: string, excludeNullXfer: boolean) =>
		request<{ txs: TxSummary[] }>(
			path(
				`/txs${params({ active, page: 0, count: 1_000_000_000, excludeNullXfer: excludeNullXfer ? 1 : undefined })}`,
			),
		),
	blocksRescan: (fromHeight: number, toHeight: number) =>
		request<{ fromHeight: number; toHeight: number }>(
			path(`/tracker/support/rescan${params({ fromHeight, toHeight })}`),
		),
};
export function pairingPayload(info: Pairing, key?: string): Pairing {
	return {
		...info,
		pairing: {
			...info.pairing,
			url: `${location.origin}${apiBase}`,
			...(key ? { apikey: key } : {}),
		},
	};
}

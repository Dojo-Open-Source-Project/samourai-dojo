import {
	createContext,
	Fragment,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
import QRCode from "react-qr-code";
import type { Explorer, TxSummary, Utxo } from "./api";

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

type Notice = { kind: "message" | "error" | "info"; text: string } | null;
const NoticeContext = createContext<{
	notice: Notice;
	show: (kind: NonNullable<Notice>["kind"], text: string) => void;
	clear: () => void;
} | null>(null);
export function NoticeProvider({ children }: { children: ReactNode }) {
	const [notice, setNotice] = useState<Notice>(null);
	const show = useCallback(
		(kind: NonNullable<Notice>["kind"], text: string) =>
			setNotice({ kind, text }),
		[],
	);
	const clear = useCallback(() => setNotice(null), []);
	return (
		<NoticeContext.Provider
			value={{
				notice,
				show,
				clear,
			}}
		>
			{children}
			<div id="box-msg">
				<div className="row box-msg">
					<div className="col-xs-12">
						<div id="msg" className="msg">
							{notice?.kind === "message" && notice.text}
						</div>
						<div id="errors" className="msg-error" role="alert">
							{notice?.kind === "error" && notice.text}
						</div>
						<div id="info" className="msg-info" role="status">
							{notice?.kind === "info" && notice.text}
						</div>
					</div>
				</div>
			</div>
		</NoticeContext.Provider>
	);
}
export function useNotice() {
	const value = useContext(NoticeContext);
	if (!value) throw new Error("NoticeProvider is missing");
	return value;
}
export function Section({
	id,
	title,
	children,
	className = "fullwidth",
}: {
	id?: string;
	title: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div id={id} className={`${className} box`}>
			<div className="box-header">{title}</div>
			<div className="spacer10" />
			<div className="box-body">{children}</div>
		</div>
	);
}
export function Rows({ rows }: { rows: [string, ReactNode][] }) {
	return (
		<table>
			<tbody>
				{rows.map(([label, value]) => (
					<tr key={label}>
						<td className="table-label">{label}</td>
						<td className="table-value">{value ?? "-"}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
export function Qr({ value, logo }: { value: string; logo?: string }) {
	return (
		<div className="qr-image">
			<QRCode value={value} size={256} level="M" />
			{logo && (
				<div className="qr-logo" style={{ backgroundImage: `url(${logo})` }} />
			)}
		</div>
	);
}
export function period(value?: number) {
	if (value == null) return "—";
	const whole = Math.floor(value);
	const parts = [
		Math.floor(whole / 3600) % 24,
		Math.floor(whole / 60) % 60,
		whole % 60,
	].map((v) => String(v).padStart(2, "0"));
	if (whole >= 86400)
		parts.unshift(String(Math.floor(whole / 86400)).padStart(3, "0"));
	return parts.join(":");
}
export function date(ts?: number) {
	return ts == null ? "—" : new Date(ts * 1000).toLocaleString();
}
export function btc(sats?: number | string) {
	return `${Number(sats ?? 0) / 100_000_000} BTC`;
}
export function explorerUrl(txid: string, explorer?: Explorer) {
	if (!explorer?.url) return undefined;
	const suffix =
		explorer.type === "explorer.oxt"
			? "transaction"
			: explorer.type === "explorer.btc_rpc_explorer"
				? "tx"
				: undefined;
	return suffix
		? `${explorer.url.replace(/\/$/, "")}/${suffix}/${encodeURIComponent(txid)}`
		: undefined;
}
export function History({
	id,
	txs,
	utxos,
	explorer,
}: {
	id?: string;
	txs?: TxSummary[];
	utxos?: Utxo[];
	explorer?: Explorer;
}) {
	return (
		<div id={id} className="row box-main">
			<Section
				id="box-txs"
				title="MOST RECENT TRANSACTIONS"
				className="halfwidth-left"
			>
				<table>
					<tbody>
						<tr>
							<td />
							<td />
						</tr>
						{txs?.map((tx) => {
							const amount = Number(tx.result) / 100_000_000;
							const href = explorerUrl(tx.hash, explorer);
							return (
								<Fragment key={tx.hash}>
									<tr className="tx-row">
										<td colSpan={2}>&nbsp;</td>
									</tr>
									<tr className="tx-row">
										<td className="table-label" colSpan={2}>
											{href ? (
												<a href={href} target="_blank" rel="noreferrer">
													{tx.hash.slice(0, 50)}...
												</a>
											) : (
												`${tx.hash.slice(0, 50)}...`
											)}
										</td>
									</tr>
									<tr className="tx-row">
										<td className="table-label">Amount</td>
										<td
											className={`table-value ${amount < 0 ? "amount-sent" : "amount-received"}`}
										>
											{amount >= 0 ? "+" : ""}
											{amount} BTC
										</td>
									</tr>
									<tr className="tx-row">
										<td className="table-label">Block height</td>
										<td className="table-value">{tx.block_height}</td>
									</tr>
									<tr className="tx-row">
										<td className="table-label">Date</td>
										<td className="table-value">{date(tx.time)}</td>
									</tr>
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</Section>
			<Section
				id="box-utxos"
				title="UNSPENT TRANSACTION OUTPUTS"
				className="halfwidth-right"
			>
				<table>
					<tbody>
						<tr>
							<td />
							<td />
						</tr>
						{utxos?.map((utxo) => {
							const href = explorerUrl(utxo.tx_hash, explorer);
							return (
								<Fragment key={`${utxo.tx_hash}:${utxo.tx_output_n}`}>
									<tr className="utxo-row">
										<td colSpan={2}>&nbsp;</td>
									</tr>
									<tr className="utxo-row">
										<td className="table-label" colSpan={2}>
											{href ? (
												<a href={href} target="_blank" rel="noreferrer">
													{utxo.tx_hash.slice(0, 50)}...:{utxo.tx_output_n}
												</a>
											) : (
												`${utxo.tx_hash.slice(0, 50)}...:${utxo.tx_output_n}`
											)}
										</td>
									</tr>
									<tr className="utxo-row">
										<td className="table-label">Amount</td>
										<td className="table-value">{btc(utxo.value)}</td>
									</tr>
									<tr className="utxo-row">
										<td className="table-label">Address</td>
										<td className="table-value">{utxo.addr}</td>
									</tr>
									<tr className="utxo-row">
										<td className="table-label">Confirmations</td>
										<td className="table-value">{utxo.confirmations}</td>
									</tr>
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</Section>
		</div>
	);
}

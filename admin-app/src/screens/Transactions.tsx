import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
	btc,
	date,
	errorMessage,
	explorerUrl,
	Rows,
	Section,
	useNotice,
} from "../ui";

export function TransactionsScreen() {
	const searchInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		searchInput.current?.focus();
	}, []);
	const notice = useNotice();
	const [input, setInput] = useState("");
	const [txid, setTxid] = useState("");
	const tx = useQuery({
		queryKey: ["transaction", txid],
		queryFn: ({ signal }) => api.tx(txid, signal),
		enabled: Boolean(txid),
	});
	const hex = useQuery({
		queryKey: ["transaction-hex", txid],
		queryFn: ({ signal }) => api.txHex(txid, signal),
		enabled: Boolean(tx.data),
	});
	const pairing = useQuery({
		queryKey: ["pairing"],
		queryFn: ({ signal }) => api.pairing(signal),
	});
	const href = explorerUrl(txid, pairing.data?.explorer);
	function search(event: FormEvent) {
		event.preventDefault();
		if (!input.trim()) return;
		setTxid(input.trim());
		notice.clear();
	}
	function reset() {
		setInput("");
		setTxid("");
		notice.clear();
	}
	const data = tx.data;
	const amount = data
		? Number(data.fees ?? 0) +
			(data.outputs ?? []).reduce(
				(sum, output) => sum + Number(output.value ?? 0),
				0,
			)
		: 0;
	const locktime = Number(data?.locktime ?? 0);
	return (
		<div id="txs-tool">
			<h1>TRANSACTIONS TOOL</h1>
			<div className="box-context">
				Check if a transaction is found in a block or in the mempool of your
				full node.
			</div>
			<div className="row box-main">
				{!txid && (
					<form
						id="txs-tool-search-form"
						className="fullwidth box"
						onSubmit={search}
					>
						<div className="box-body">
							Search transaction with this{" "}
							<input
								id="txid"
								ref={searchInput}
								type="text"
								placeholder="TXID"
								value={input}
								onChange={(e) => setInput(e.target.value)}
							/>{" "}
							<button type="submit" className="btn btn-success">
								GO
							</button>
						</div>
					</form>
				)}
				{txid && tx.isPending && (
					<div className="fullwidth box">
						<div className="box-body">Search in progress...</div>
					</div>
				)}
				{txid && tx.isError && (
					<div className="fullwidth box">
						<div className="box-body">
							<p role="alert">No transaction found: {errorMessage(tx.error)}</p>
							<button type="button" className="btn btn-success" onClick={reset}>
								SEARCH ANOTHER TRANSACTION
							</button>
						</div>
					</div>
				)}
				{data && (
					<div id="txs-tool-details">
						<div id="txs-tool-header" className="row box-main">
							<div className="fullwidth box">
								<div className="box-body center">
									{href ? (
										<a
											id="txid-value"
											href={href}
											target="_blank"
											rel="noreferrer"
										>
											{txid}
										</a>
									) : (
										<span id="txid-value">{txid}</span>
									)}
								</div>
							</div>
						</div>
						<div id="txs-tool-actions" className="row box-main">
							<div className="center">
								<button
									type="button"
									className="btn btn-success"
									onClick={reset}
								>
									SEARCH ANOTHER TRANSACTION
								</button>
							</div>
						</div>
						<div id="txs-tool-details-row1" className="row box-main">
							<Section
								id="box-general"
								title="GENERAL INFO"
								className="halfwidth-left"
							>
								<Rows
									rows={[
										[
											"First-seen date",
											data.created ? date(data.created) : "--",
										],
										[
											"Found in",
											data.block ? (
												<span key="block" className="chip chip-ok">
													BLOCK {data.block.height}
												</span>
											) : (
												<span key="mempool" className="chip chip-ko">
													MEMPOOL
												</span>
											),
										],
										["Amount", btc(amount)],
										["Fees", `${data.fees ?? 0} sats`],
										["Feerate", `${data.vfeerate ?? "-"} sats/vbyte`],
										["Number of inputs", data.inputs?.length ?? 0],
										["Number of outputs", data.outputs?.length ?? 0],
									]}
								/>
							</Section>
							<Section
								id="box-technical"
								title="TECHNICAL INFO"
								className="halfwidth-right"
							>
								<Rows
									rows={[
										["Virtual size", `${data.vsize ?? "-"} vbytes`],
										["Raw size", `${data.size ?? "-"} bytes`],
										["Transaction version", data.version],
										[
											"nLockTime",
											locktime < 500_000_000
												? `Block ${locktime}`
												: date(locktime),
										],
									]}
								/>
							</Section>
						</div>
						{hex.data?.data && (
							<div id="txs-tool-hex" className="row box-main">
								<div className="box fullwidth">
									<div className="box-header">TX HEX</div>
									<textarea
										className="payload-textarea"
										rows={10}
										readOnly
										value={hex.data.data}
									/>
								</div>
							</div>
						)}
						{hex.isError && (
							<div role="alert" className="msg-error">
								No transaction hex found
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

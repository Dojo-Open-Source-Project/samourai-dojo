import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { date, errorMessage, period, Rows, Section, useNotice } from "../ui";

type IndicatorState = "ok" | "ko" | "desynchronized" | "idle";
function Indicator({ state }: { state: IndicatorState }) {
	const color = {
		ok: "#4ec98a",
		ko: "#ff563c",
		desynchronized: "#f0c649",
		idle: "#f3f2f2",
	}[state];
	return (
		<span style={{ color }}>
			{state === "desynchronized" ? (
				"✓"
			) : state === "idle" ? (
				"-"
			) : (
				<>
					{state === "ok" ? "CONNECTED" : "DISCONNECTED"}
					<span className="status-dot" />
				</>
			)}
		</span>
	);
}
function headline(label: string, value: string | number | undefined) {
	return (
		<div className="headline-cell" key={label}>
			<div className="headline-label">{label}</div>
			<div className="headline-value">{value ?? "—"}</div>
		</div>
	);
}
export function StatusScreen() {
	const status = useQuery({
		queryKey: ["status"],
		queryFn: ({ signal }) => api.status(signal),
		refetchInterval: 60_000,
	});
	const push = useQuery({
		queryKey: ["push-status"],
		queryFn: ({ signal }) => api.pushStatus(signal),
		refetchInterval: 60_000,
	});
	const data = status.data;
	const bitcoind = push.data?.data.bitcoind;
	const dbHeight = data?.blocks ?? 0;
	const indexerHeight = data?.indexer?.maxHeight ?? 0;
	const nodeHeight = bitcoind?.blocks ?? 0;
	const behindDb = Boolean(
		(bitcoind && dbHeight && nodeHeight > dbHeight) ||
			(bitcoind && indexerHeight && nodeHeight < indexerHeight),
	);
	const behindIndexer = Boolean(
		bitcoind && indexerHeight && nodeHeight > indexerHeight,
	);
	const relayFee = bitcoind
		? `${(Number(bitcoind.relayfee) * 100_000).toFixed(2)} sats/vB`
		: "—";
	return (
		<div id="status">
			<h1>DOJO STATUS</h1>
			<div className="box-context">
				Monitor the health of some core components of your Dojo.
			</div>
			{status.isError && (
				<div role="alert" className="msg-error">
					{errorMessage(status.error)}
				</div>
			)}
			{push.isError && (
				<div role="alert" className="msg-error">
					{errorMessage(push.error)}
				</div>
			)}
			<div className="headline-strip">
				{headline("Block Height", bitcoind?.blocks)}
				{headline("Uptime", period(push.data?.data.uptime))}
				{headline("Peers", bitcoind?.conn)}
				{headline("Relay Fee", relayFee)}
			</div>
			<div className="row box-main">
				<div id="left-column" className="two-columns-left">
					<Section title="FULL NODE">
						<Rows
							rows={[
								[
									"Status",
									<Indicator
										key="status"
										state={
											push.isError
												? "ko"
												: !bitcoind
													? "idle"
													: indexerHeight > nodeHeight
														? "desynchronized"
														: "ok"
										}
									/>,
								],
								["Uptime", period(push.data?.data.uptime)],
								["Latest block", bitcoind?.blocks],
								["Bitcoind version", bitcoind?.version],
								[
									"Network",
									bitcoind ? (bitcoind.testnet ? "testnet" : "mainnet") : "-",
								],
								["Connected nodes", bitcoind?.conn],
								["Network relay fee", relayFee],
							]}
						/>
					</Section>
					<Section title="INDEXER">
						<Rows
							rows={[
								[
									"Status",
									<Indicator
										key="status"
										state={
											status.isError
												? "ko"
												: !data
													? "idle"
													: !indexerHeight
														? "ko"
														: behindIndexer
															? "desynchronized"
															: "ok"
										}
									/>,
								],
								["Latest block", indexerHeight || "-"],
								[
									"Indexer type",
									data?.indexer?.type?.replaceAll("_", " ") ?? "-",
								],
								["URL", data?.indexer?.url ?? "-"],
							]}
						/>
					</Section>
				</div>
				<div id="right-column" className="two-columns-right">
					<Section title="TRACKER">
						<Rows
							rows={[
								[
									"Status",
									<Indicator
										key="status"
										state={
											status.isError
												? "ko"
												: !data
													? "idle"
													: !dbHeight
														? "ko"
														: behindDb
															? "desynchronized"
															: "ok"
										}
									/>,
								],
								["Uptime", data?.uptime ?? "-"],
								["Latest block", dbHeight || "-"],
							]}
						/>
					</Section>
					<Section title="DOJO DB">
						<Rows
							rows={[
								[
									"Status",
									<Indicator
										key="status"
										state={
											status.isError
												? "ko"
												: !data
													? "idle"
													: !dbHeight
														? "ko"
														: behindDb
															? "desynchronized"
															: "ok"
										}
									/>,
								],
								["Latest block", dbHeight || "-"],
							]}
						/>
					</Section>
					<Section title="WEB SERVICES">
						<Rows
							rows={[
								[
									"Tor status",
									<span key="service" className="web-service-status">
										CONNECTED
										<span className="status-dot" />
									</span>,
								],
								[
									"Nginx status",
									<span key="service" className="web-service-status">
										CONNECTED
										<span className="status-dot" />
									</span>,
								],
								[
									"Node.js status",
									<span key="service" className="web-service-status">
										CONNECTED
										<span className="status-dot" />
									</span>,
								],
							]}
						/>
					</Section>
				</div>
			</div>
		</div>
	);
}
export function PushTxScreen() {
	const push = useQuery({
		queryKey: ["push-status"],
		queryFn: ({ signal }) => api.pushStatus(signal),
		refetchInterval: 60_000,
	});
	const schedule = useQuery({
		queryKey: ["schedule"],
		queryFn: ({ signal }) => api.schedule(signal),
		refetchInterval: 60_000,
	});
	const txs = schedule.data?.data.txs ?? [];
	return (
		<div id="pushtx-status">
			<h1>PUSHTX STATUS</h1>
			<div className="box-context">
				Monitor the transactions pushed through your Dojo.
			</div>
			{push.isError && (
				<div role="alert" className="msg-error">
					{errorMessage(push.error)}
				</div>
			)}
			{schedule.isError && (
				<div role="alert" className="msg-error">
					{errorMessage(schedule.error)}
				</div>
			)}
			<div className="headline-strip">
				{headline("Uptime", period(push.data?.data.uptime))}
				{headline("Transactions Pushed", push.data?.data.push.count)}
				{headline("Total Amount", push.data?.data.push.amount)}
			</div>
			<div className="row box-main">
				<div id="txs-scheduled" className="box fullwidth">
					<div className="box-header">
						<span>SCHEDULED TRANSACTIONS</span>
						<span id="scheduled-count" className="box-header-count">
							{txs.length}
						</span>
					</div>
					<div className="box-body">
						<table id="table-scheduled-txs">
							{txs.map((tx) => (
								<tbody key={tx.schID}>
									<tr>
										<td className="table-label">TXID</td>
										<td className="table-value">{tx.schTxid}</td>
									</tr>
									<tr>
										<td className="table-label">Schedule Id</td>
										<td className="table-value">{tx.schID}</td>
									</tr>
									<tr>
										<td className="table-label">Scheduled for block</td>
										<td className="table-value">{tx.schTrigger}</td>
									</tr>
									<tr>
										<td className="table-label">Created on</td>
										<td className="table-value">{date(tx.schCreated)}</td>
									</tr>
									<tr>
										<td className="table-label">Parent TXID</td>
										<td className="table-value">{tx.schParentTxid}</td>
									</tr>
								</tbody>
							))}
						</table>
					</div>
				</div>
			</div>
		</div>
	);
}
export function BlocksRescanScreen() {
	const firstInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		firstInput.current?.focus();
	}, []);
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const notice = useNotice();
	const rescan = useMutation({
		mutationFn: ({ first, last }: { first: number; last: number }) =>
			api.blocksRescan(first, last),
		onSuccess: (result) => {
			notice.show(
				"info",
				`successfully rescanned blocks between height ${result.fromHeight} and height ${result.toHeight}`,
			);
			setFrom("");
			setTo("");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	function submit(event: FormEvent) {
		event.preventDefault();
		const first = Number.parseInt(from, 10);
		const last = to ? Number.parseInt(to, 10) : first;
		if (!Number.isFinite(first) || !Number.isFinite(last)) {
			notice.show("error", "Enter valid block heights");
			return;
		}
		notice.show("message", "Processing...");
		rescan.mutate({ first, last });
	}
	return (
		<div id="blocks-rescan">
			<h1>BLOCKS RESCAN</h1>
			<div className="box-context">
				Force the Tracker to rescan a small range of blocks.
			</div>
			<div className="row box-main">
				<form
					id="blocks-rescan-form"
					className="box fullwidth"
					onSubmit={submit}
				>
					<div className="box-body">
						<span>Rescan blocks between</span>{" "}
						<input
							id="rescan-from-height"
							ref={firstInput}
							type="text"
							inputMode="numeric"
							placeholder="height"
							value={from}
							onChange={(e) => setFrom(e.target.value)}
						/>{" "}
						<span>and</span>{" "}
						<input
							id="rescan-to-height"
							type="text"
							inputMode="numeric"
							placeholder="height"
							value={to}
							onChange={(e) => setTo(e.target.value)}
						/>{" "}
						<button
							className="btn btn-success"
							type="submit"
							disabled={rescan.isPending}
						>
							GO
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

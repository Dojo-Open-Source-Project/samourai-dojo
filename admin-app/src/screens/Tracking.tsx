import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { btc, errorMessage, History, Rows, Section, useNotice } from "../ui";

export function AddressScreen() {
	const searchInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		searchInput.current?.focus();
	}, []);
	const notice = useNotice();
	const client = useQueryClient();
	const [input, setInput] = useState("");
	const [address, setAddress] = useState("");
	const [rescanForm, setRescanForm] = useState(false);
	const info = useQuery({
		queryKey: ["address", address],
		queryFn: ({ signal }) => api.address(address, signal),
		enabled: Boolean(address),
	});
	const wallet = useQuery({
		queryKey: ["wallet", address],
		queryFn: ({ signal }) => api.wallet(address, signal),
		enabled: Boolean(address && info.data?.tracked),
	});
	const pairing = useQuery({
		queryKey: ["pairing"],
		queryFn: ({ signal }) => api.pairing(signal),
	});
	const importAddress = useMutation({
		mutationFn: () => api.wallet(address),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["address", address] });
			await client.invalidateQueries({ queryKey: ["wallet", address] });
			notice.show("info", "Import complete");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	const rescan = useMutation({
		mutationFn: () => api.addressRescan(address),
		onSuccess: async () => {
			setRescanForm(false);
			await client.invalidateQueries({ queryKey: ["address", address] });
			await client.invalidateQueries({ queryKey: ["wallet", address] });
			notice.show("info", "Rescan complete");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	function search(event: FormEvent) {
		event.preventDefault();
		if (!input.trim()) return;
		setAddress(input.trim());
		notice.clear();
	}
	function reset() {
		setAddress("");
		setInput("");
		setRescanForm(false);
		notice.clear();
	}
	const tracked = info.data?.tracked;
	return (
		<div id="addresses-tool">
			<h1>ADDRESSES TOOL</h1>
			<div className="box-context">
				Check if an address is tracked by your Dojo. Import and track a new
				address. Rescan the full history of an address.
			</div>
			<div className="row box-main">
				{!address && (
					<form
						id="addresses-tool-search-form"
						className="fullwidth box"
						onSubmit={search}
					>
						<div className="box-body">
							<span>Check if </span>
							<input
								id="address"
								ref={searchInput}
								type="text"
								placeholder="address"
								value={input}
								onChange={(e) => setInput(e.target.value)}
							/>
							<span> is tracked by your Dojo </span>
							<button type="submit" className="btn btn-success">
								GO
							</button>
						</div>
					</form>
				)}
				{address && info.isPending && (
					<div className="fullwidth box">
						<div className="box-body">Search in progress...</div>
					</div>
				)}
				{address && info.isError && (
					<div className="fullwidth box">
						<div className="box-body">
							<p role="alert">{errorMessage(info.error)}</p>
							<button type="button" className="btn btn-success" onClick={reset}>
								SEARCH ANOTHER ADDRESS
							</button>
						</div>
					</div>
				)}
				{address && info.data && !tracked && (
					<div id="addresses-tool-import" className="fullwidth box">
						<div className="box-body">
							<div>This address isn't tracked by your Dojo.</div>
							<div className="spacer20" />
							<div>
								Do you want to import <span id="import-address">{address}</span>{" "}
								and track its activity?{" "}
								<button
									type="button"
									className="btn btn-success"
									onClick={() => {
										notice.show(
											"message",
											"Processing address import. Please wait...",
										);
										importAddress.mutate();
									}}
									disabled={importAddress.isPending}
								>
									IMPORT
								</button>{" "}
								<button
									type="button"
									className="btn btn-success"
									onClick={reset}
								>
									CANCEL
								</button>
							</div>
						</div>
					</div>
				)}
				{address && tracked && (
					<div id="addresses-tool-details">
						<div id="addresses-tool-header" className="row box-main">
							<div className="fullwidth box">
								<div id="addr-value" className="box-body center">
									{address}
								</div>
							</div>
						</div>
						<div
							id={
								rescanForm
									? "addresses-rescans-actions"
									: "addresses-tool-actions"
							}
							className="row box-main"
						>
							<div className="center">
								{rescanForm ? (
									<>
										Do you want to rescan this address?{" "}
										<button
											type="button"
											className="btn btn-success"
											disabled={rescan.isPending}
											onClick={() => {
												notice.show(
													"message",
													"Processing address rescan. Please wait...",
												);
												rescan.mutate();
											}}
										>
											RESCAN
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setRescanForm(false)}
										>
											CANCEL
										</button>
									</>
								) : (
									<>
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setRescanForm(true)}
										>
											RESCAN THIS ADDRESS
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={reset}
										>
											SEARCH ANOTHER ADDRESS
										</button>
									</>
								)}
							</div>
						</div>
						<div id="addresses-tool-details-row1" className="row box-main">
							<Section id="box-general" title="GENERAL INFO">
								<Rows
									rows={[
										["Balance", btc(info.data?.balance)],
										["Number of Txs", info.data?.n_tx],
										[
											"Number of UTXOs",
											wallet.data?.unspent_outputs?.length ?? "-",
										],
										[
											"Segwit",
											<span
												key="segwit"
												style={{
													color: info.data?.segwit ? "#76d776" : "#f77c7c",
												}}
											>
												{info.data?.segwit ? "✓" : "-"}
											</span>,
										],
										[
											"Address Type",
											info.data?.type === "hd"
												? "Derived from an XPUB"
												: "Loose address",
										],
									]}
								/>
							</Section>
						</div>
						{info.data?.type === "hd" && (
							<div id="addresses-tool-details-row2" className="row box-main">
								<Section id="box-hd" title="DERIVATION INFO">
									<table>
										<tbody>
											<tr>
												<td className="table-label">Derivation path</td>
												<td className="table-value">{info.data?.path}</td>
											</tr>
											<tr>
												<td className="table-label" colSpan={2}>
													Derived from
												</td>
											</tr>
											<tr>
												<td id="addr-xpub" colSpan={2}>
													{info.data?.xpub}
												</td>
											</tr>
										</tbody>
									</table>
								</Section>
							</div>
						)}
						<History
							id="addresses-tool-details-row3"
							txs={wallet.data?.txs}
							utxos={wallet.data?.unspent_outputs?.toSorted(
								(a, b) => a.confirmations - b.confirmations,
							)}
							explorer={pairing.data?.explorer}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

export function XpubScreen() {
	const searchInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		searchInput.current?.focus();
	}, []);
	const notice = useNotice();
	const client = useQueryClient();
	const [input, setInput] = useState("");
	const [xpub, setXpub] = useState("");
	const [mode, setMode] = useState<
		"view" | "import" | "retype" | "rescan" | "delete" | "export"
	>("view");
	const [derivation, setDerivation] = useState("auto");
	const [startIndex, setStartIndex] = useState("0");
	const [lookahead, setLookahead] = useState("100");
	const [exportType, setExportType] = useState("full");
	const [waiting, setWaiting] = useState(false);
	const info = useQuery({
		queryKey: ["xpub", xpub],
		queryFn: ({ signal }) => api.xpub(xpub, signal),
		enabled: Boolean(xpub),
	});
	const wallet = useQuery({
		queryKey: ["wallet", xpub],
		queryFn: ({ signal }) => api.wallet(xpub, signal),
		enabled: Boolean(xpub && info.data?.tracked),
	});
	const pairing = useQuery({
		queryKey: ["pairing"],
		queryFn: ({ signal }) => api.pairing(signal),
	});
	const status = useQuery({
		queryKey: ["xpub-import-status", xpub],
		queryFn: ({ signal }) => api.xpubRescanStatus(xpub, signal),
		enabled: waiting,
		refetchInterval: waiting ? 1000 : false,
		retry: true,
	});
	const nodeStatus = useQuery({
		queryKey: ["status"],
		queryFn: ({ signal }) => api.status(signal),
	});
	useEffect(() => {
		if (!waiting || !status.data || status.data.data.import_in_progress) return;
		setWaiting(false);
		setMode("view");
		void Promise.all([
			client.invalidateQueries({ queryKey: ["xpub", xpub] }),
			client.invalidateQueries({ queryKey: ["wallet", xpub] }),
		]);
		notice.show(
			"info",
			status.data.data.status === "rescan"
				? "Rescan complete"
				: "Import complete",
		);
	}, [waiting, status.data, xpub, client, notice.show]);
	useEffect(() => {
		if (waiting && status.data?.data.import_in_progress) {
			const { status: operation, hits } = status.data.data;
			notice.show(
				"message",
				`${operation === "rescan" ? "Rescan" : "Import"} in progress (${hits} ${operation === "rescan" ? "hits detected" : "transactions imported"})`,
			);
		}
	}, [waiting, status.data, notice.show]);
	const importXpub = useMutation({
		mutationFn: () => {
			let segwit =
				derivation === "bip49" || derivation === "bip84"
					? derivation
					: undefined;
			if (derivation === "auto") {
				if (/^(ypub|upub)/.test(xpub)) segwit = "bip49";
				if (/^(zpub|vpub)/.test(xpub)) segwit = "bip84";
			}
			return api.xpubImport({ xpub, type: "restore", force: true, segwit });
		},
		onSuccess: () => {
			client.removeQueries({ queryKey: ["xpub-import-status", xpub] });
			setWaiting(true);
			notice.show("message", "Processing xpub import. Please wait...");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	const rescan = useMutation({
		mutationFn: () =>
			api.xpubRescan(xpub, Number(lookahead), Number(startIndex)),
		onSuccess: () => {
			client.removeQueries({ queryKey: ["xpub-import-status", xpub] });
			setWaiting(true);
			notice.show("message", "Processing xpub rescan. Please wait...");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	const remove = useMutation({
		mutationFn: () => api.xpubDelete(xpub),
		onSuccess: () => {
			reset();
			notice.show("info", "Xpub successfully deleted");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	const exportHistory = useMutation({
		mutationFn: () => api.txs(xpub, exportType === "notNull"),
		onSuccess: (result) => {
			if (result.txs?.length) {
				const csv = [
					"height,txid,date,flow",
					...result.txs.map((tx) =>
						[
							tx.block_height,
							tx.hash,
							new Date(tx.time * 1000).toString(),
							Number(tx.result) / 100_000_000,
						].join(","),
					),
				].join("\n");
				const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = "xpub-history.csv";
				link.click();
				URL.revokeObjectURL(url);
			}
			setMode("view");
			notice.show("info", "Transactional history successfully exported.");
		},
		onError: (error) => notice.show("error", errorMessage(error)),
	});
	function search(event: FormEvent) {
		event.preventDefault();
		if (!input.trim()) return;
		setXpub(input.trim());
		setMode("view");
		notice.clear();
	}
	function reset() {
		setXpub("");
		setInput("");
		setMode("view");
		setWaiting(false);
		notice.clear();
	}
	const showImport =
		xpub &&
		info.data &&
		(!info.data?.tracked || mode === "retype" || mode === "import");
	const showDetails =
		xpub && info.data?.tracked && mode !== "retype" && mode !== "import";
	const indexerType = nodeStatus.data?.indexer?.type;
	const disableLookahead =
		indexerType === "third_party_explorer" ||
		indexerType === "local_rest_indexer";
	return (
		<div id="xpubs-tool">
			<h1>XPUBS TOOL</h1>
			<div className="box-context">
				Check if a XPUB is tracked by your Dojo. Import and track a new XPUB.
				Rescan the full history of a XPUB.
			</div>
			<div className="row box-main">
				{!xpub && (
					<form
						id="xpubs-tool-search-form"
						className="fullwidth box"
						onSubmit={search}
					>
						<div className="box-body">
							Check if{" "}
							<input
								id="xpub"
								ref={searchInput}
								type="text"
								placeholder="XPUB"
								value={input}
								onChange={(e) => setInput(e.target.value)}
							/>{" "}
							is tracked by your Dojo{" "}
							<button type="submit" className="btn btn-success">
								GO
							</button>
						</div>
					</form>
				)}
				{xpub && info.isPending && (
					<div className="fullwidth box">
						<div className="box-body">Search in progress...</div>
					</div>
				)}
				{xpub && info.isError && (
					<div className="fullwidth box">
						<div className="box-body">
							<p role="alert">{errorMessage(info.error)}</p>
							<button type="button" className="btn btn-success" onClick={reset}>
								SEARCH ANOTHER XPUB
							</button>
						</div>
					</div>
				)}
				{showImport && (
					<div id="xpubs-tool-import" className="fullwidth box">
						<div className="box-body">
							{mode === "retype" ? (
								<div>
									Do you want to reimport this XPUB with a new derivation type?
									<br />
									<br />
									WARNING: Are you sure you need to retype this XPUB? Generally,
									the 'auto' derivation will type your XPUB correctly.
									<br />
									Retyping your XPUB is reserved for very specific
									circumstances, and should not be taken lightly.
									<br />
									If in doubt, contact{" "}
									<a href="mailto:support@samouraiwallet.com">
										support@samouraiwallet.com
									</a>
								</div>
							) : (
								<div>
									This XPUB isn't tracked by your Dojo. Do you want to import it
									and track its activity?
								</div>
							)}
							<div className="spacer20" />
							Import "{xpub.slice(0, 20)}...{xpub.slice(-20)}" with a{" "}
							<select
								value={derivation}
								onChange={(e) => setDerivation(e.target.value)}
							>
								<option value="auto">auto</option>
								<option value="bip44">BIP44</option>
								<option value="bip49">BIP49</option>
								<option value="bip84">BIP84</option>
							</select>{" "}
							derivation{" "}
							<button
								type="button"
								className="btn btn-success"
								disabled={waiting || importXpub.isPending}
								onClick={() => importXpub.mutate()}
							>
								IMPORT
							</button>{" "}
							<button
								type="button"
								className="btn btn-success"
								onClick={() => (mode === "retype" ? setMode("view") : reset())}
							>
								CANCEL
							</button>
						</div>
					</div>
				)}
				{showDetails && (
					<div id="xpubs-tool-details">
						<div id="xpubs-tool-header" className="row box-main">
							<div className="fullwidth box">
								<div id="xpub-value" className="box-body center">
									{xpub}
								</div>
							</div>
						</div>
						<div
							id={
								mode === "rescan"
									? "xpubs-rescans-actions"
									: mode === "delete"
										? "xpubs-deletion-actions"
										: mode === "export"
											? "xpubs-export-actions"
											: "xpubs-tool-actions"
							}
							className="row box-main"
						>
							<div className="center">
								{mode === "view" ? (
									<>
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setMode("rescan")}
										>
											RESCAN
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setMode("retype")}
										>
											RETYPE
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setMode("delete")}
										>
											DELETE
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setMode("export")}
										>
											CSV EXPORT
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={reset}
										>
											SEARCH ANOTHER XPUB
										</button>
									</>
								) : mode === "rescan" ? (
									<>
										Rescan this XPUB starting at index{" "}
										<input
											type="text"
											placeholder="index"
											value={startIndex}
											onChange={(e) => setStartIndex(e.target.value)}
										/>{" "}
										with a lookahead of{" "}
										<input
											type="text"
											placeholder="#addresses"
											value={lookahead}
											disabled={disableLookahead}
											onChange={(e) => setLookahead(e.target.value)}
										/>{" "}
										addresses{" "}
										<button
											type="button"
											className="btn btn-success"
											disabled={waiting || rescan.isPending}
											onClick={() => rescan.mutate()}
										>
											RESCAN
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setMode("view")}
										>
											CANCEL
										</button>
									</>
								) : mode === "delete" ? (
									<>
										Do you want to delete this XPUB?{" "}
										<button
											type="button"
											className="btn btn-success"
											disabled={remove.isPending}
											onClick={() => remove.mutate()}
										>
											DELETE
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setMode("view")}
										>
											CANCEL
										</button>
									</>
								) : (
									<>
										Do you want to export a list of{" "}
										<select
											value={exportType}
											onChange={(e) => setExportType(e.target.value)}
										>
											<option value="full">all the transactions</option>
											<option value="notNull">
												the transactions modifying the balance
											</option>
										</select>{" "}
										of this XPUB?{" "}
										<button
											type="button"
											className="btn btn-success"
											disabled={exportHistory.isPending}
											onClick={() => exportHistory.mutate()}
										>
											EXPORT
										</button>{" "}
										<button
											type="button"
											className="btn btn-success"
											onClick={() => setMode("view")}
										>
											CANCEL
										</button>
									</>
								)}
							</div>
						</div>
						<div id="xpubs-tool-details-row1" className="row box-main">
							<Section
								id="box-general"
								title="GENERAL INFO"
								className="halfwidth-left"
							>
								<Rows
									rows={[
										["Derivation Type", info.data?.derivation],
										["Balance", btc(info.data?.balance)],
										["Number of Txs", info.data?.n_tx],
										[
											"Number of UTXOs",
											wallet.data?.unspent_outputs?.length ?? "-",
										],
										["Tracked since", info.data?.created],
									]}
								/>
							</Section>
							<Section
								id="box-derivation"
								title="XPUB DERIVATION INFO"
								className="halfwidth-right"
							>
								<table>
									<tbody>
										<tr>
											<td className="table-label">Account</td>
											<td className="table-value">{info.data?.account}</td>
											<td className="table-label">Depth</td>
											<td className="table-value">{info.data?.depth}</td>
										</tr>
									</tbody>
								</table>
								<div className="spacer10" />
								<table id="table-deriv-idx">
									<tbody>
										<tr>
											<td className="table-label" colSpan={2}>
												First unused indices
											</td>
											<td className="table-label" colSpan={2}>
												Last derived indices
											</td>
										</tr>
										<tr>
											<td className="table-label">External</td>
											<td className="table-value">
												{info.data?.unused?.external}
											</td>
											<td className="table-label">External</td>
											<td className="table-value">
												{info.data?.derived?.external}
											</td>
										</tr>
										<tr>
											<td className="table-label">Internal</td>
											<td className="table-value">
												{info.data?.unused?.internal}
											</td>
											<td className="table-label">Internal</td>
											<td className="table-value">
												{info.data?.derived?.internal}
											</td>
										</tr>
									</tbody>
								</table>
								<div className="spacer10" />
							</Section>
						</div>
						<History
							id="xpubs-tool-details-row2"
							txs={wallet.data?.txs}
							utxos={wallet.data?.unspent_outputs?.toSorted(
								(a, b) => a.confirmations - b.confirmations,
							)}
							explorer={pairing.data?.explorer}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

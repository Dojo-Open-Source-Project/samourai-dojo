import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, refreshAccessToken } from "../api";
import { authenticated, clearTokens, refreshNeeded } from "../auth";
import { queryClient } from "../query";
import {
	BlocksRescanScreen,
	PushTxScreen,
	StatusScreen,
} from "../screens/Monitoring";
import { ApiKeysScreen, PairingScreen } from "../screens/Pairing";
import { AddressScreen, XpubScreen } from "../screens/Tracking";
import { TransactionsScreen } from "../screens/Transactions";
import { WelcomeScreen } from "../screens/Welcome";
import { NoticeProvider, useNotice } from "../ui";

export const Route = createFileRoute("/dmt")({ component: DashboardPage });
type Tab =
	| "status"
	| "pushtx"
	| "pairing"
	| "api-keys"
	| "xpubs-tools"
	| "addresses-tools"
	| "txs-tools"
	| "blocks-rescan"
	| "help-dmt";
const groups: { title: string; tabs: [Tab, string][] }[] = [
	{
		title: "MONITORING",
		tabs: [
			["status", "DOJO STATUS"],
			["pushtx", "PUSHTX STATUS"],
		],
	},
	{
		title: "TOOLS",
		tabs: [
			["pairing", "PAIRING"],
			["api-keys", "API KEYS"],
			["xpubs-tools", "XPUBS TOOL"],
			["addresses-tools", "ADDRESSES TOOL"],
			["txs-tools", "TRANSACTIONS TOOL"],
			["blocks-rescan", "BLOCKS RESCAN"],
		],
	},
	{ title: "HELP", tabs: [["help-dmt", "HELP DMT"]] },
];
function initialTab(): Tab {
	const stored = sessionStorage.getItem("activeTab")?.replace("#link-", "");
	return groups.flatMap((group) => group.tabs).some(([id]) => id === stored)
		? (stored as Tab)
		: "status";
}
function DashboardPage() {
	useEffect(() => {
		document.body.className = "dmt";
	}, []);
	return (
		<NoticeProvider>
			<Dashboard />
		</NoticeProvider>
	);
}
function Dashboard() {
	const navigate = useNavigate();
	const notice = useNotice();
	const [tab, setTab] = useState<Tab>(initialTab);
	const [menuOpen, setMenuOpen] = useState(false);
	const push = useQuery({
		queryKey: ["push-status"],
		queryFn: ({ signal }) => api.pushStatus(signal),
		refetchInterval: 60_000,
	});
	const pairing = useQuery({
		queryKey: ["pairing"],
		queryFn: ({ signal }) => api.pairing(signal),
	});
	function logout() {
		clearTokens();
		queryClient.clear();
		void navigate({ to: "/" });
	}
	useEffect(() => {
		if (!authenticated()) void navigate({ to: "/" });
	}, [navigate]);
	useEffect(() => {
		const onUnauthorized = () => {
			queryClient.clear();
			void navigate({ to: "/" });
		};
		window.addEventListener("dojo:unauthorized", onUnauthorized);
		return () =>
			window.removeEventListener("dojo:unauthorized", onUnauthorized);
	}, [navigate]);
	useEffect(() => {
		async function refresh() {
			if (!refreshNeeded()) return;
			try {
				await refreshAccessToken();
			} catch {
				/* Authentication failures dispatch dojo:unauthorized. Other failures
				   can be retried by the next request or interval. */
			}
		}
		void refresh();
		const timer = window.setInterval(refresh, 300_000);
		return () => window.clearInterval(timer);
	}, []);
	useEffect(() => {
		document.body.style.overflow = menuOpen ? "hidden" : "";
		return () => {
			document.body.style.overflow = "";
		};
	}, [menuOpen]);
	function select(next: Tab) {
		setTab(next);
		sessionStorage.setItem("activeTab", `#link-${next}`);
		setMenuOpen(false);
		notice.clear();
	}
	const sync = push.data?.data.bitcoind;
	const screen = {
		status: <StatusScreen />,
		pushtx: <PushTxScreen />,
		pairing: <PairingScreen />,
		"api-keys": <ApiKeysScreen />,
		"xpubs-tools": <XpubScreen />,
		"addresses-tools": <AddressScreen />,
		"txs-tools": <TransactionsScreen />,
		"blocks-rescan": <BlocksRescanScreen />,
		"help-dmt": <WelcomeScreen />,
	}[tab];
	return (
		<div id="top-container" className="container-fluid">
			<div id="body" className="row">
				<button
					type="button"
					id="mobile-menu-overlay"
					className={`mobile-menu-overlay ${menuOpen ? "active" : ""}`}
					aria-label="Close menu"
					onClick={() => setMenuOpen(false)}
				/>
				<div id="menu" className={`col-xs-2 ${menuOpen ? "active" : ""}`}>
					<div id="brand" className="brand">
						<div className="brand-tile">
							<img
								src="/admin/icons/dojo.svg"
								className="brand-tile-icon"
								alt=""
							/>
						</div>
						<div className="brand-wordmark">
							<div className="brand-name">DOJO</div>
							<div className="brand-subtitle">MAINTENANCE TOOL</div>
							<div id="dojo-version" className="beta">
								{pairing.data?.pairing?.version
									? `v${pairing.data.pairing.version}`
									: ""}
							</div>
						</div>
					</div>
					{groups.map((group, i) => (
						<div key={group.title}>
							<div className="title">
								<h1>{group.title}</h1>
							</div>
							<ul
								className="nav nav-pills nav-stacked"
								id={`tab-menu_list${i || ""}`}
							>
								{group.tabs.map(([id, label]) => (
									<li
										key={id}
										id={`link-${id}`}
										className={tab === id ? "active" : ""}
									>
										<a
											href={`#screen-${id}`}
											onClick={(event) => {
												event.preventDefault();
												select(id as Tab);
											}}
										>
											{label}
										</a>
									</li>
								))}
								{group.title === "HELP" && (
									<>
										<li>
											<a
												href="https://t.me/samourai_dojo"
												target="_blank"
												rel="noreferrer"
											>
												DOJO TELEGRAM CHAT
											</a>
										</li>
										<li>
											<a
												href="https://t.me/SamouraiWallet"
												target="_blank"
												rel="noreferrer"
											>
												SAMOURAI TELEGRAM CHAT
											</a>
										</li>
									</>
								)}
							</ul>
							<div className="spacer20" />
						</div>
					))}
				</div>
				<div id="menu-spacer" className="col-xs-1" />
				<div id="content-col" className="col-xs-9">
					<div id="header" className="row">
						<div className="col-xs-2">
							<button
								type="button"
								id="mobile-menu-toggle"
								className={`mobile-menu-btn ${menuOpen ? "active" : ""}`}
								aria-label="Toggle menu"
								aria-expanded={menuOpen}
								onClick={() => setMenuOpen(!menuOpen)}
							>
								<span />
								<span />
								<span />
							</button>
						</div>
						<div className="col-xs-10 header-right">
							<span
								id="sync-indicator"
								className="sync-indicator"
								data-state={push.isError ? "ko" : sync ? "ok" : "idle"}
							>
								<span className="sync-dot" />
								<span>
									SYNCED ·{" "}
									<span id="sync-block-height">{sync?.blocks ?? "—"}</span>
								</span>
							</span>
							<span id="sync-network" className="sync-network">
								{sync?.testnet ? "TESTNET" : "MAINNET"}
							</span>
							<a
								id="btn-logout"
								href="/admin/"
								title="DISCONNECT"
								onClick={(event) => {
									event.preventDefault();
									logout();
								}}
							>
								<img
									src="/admin/icons/ic_power_settings_new_white_24dp_1x.png"
									className="mini-icon"
									alt="Disconnect"
								/>
							</a>
						</div>
					</div>
					<main id="main" key={tab}>
						{screen}
					</main>
				</div>
			</div>
		</div>
	);
}

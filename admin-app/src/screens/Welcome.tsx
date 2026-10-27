export function WelcomeScreen() {
	return (
		<div id="welcome">
			<h1>WELCOME!</h1>
			<span>
				The Dojo's Maintenance Tool (DMT for short) provides a set of tools for
				monitoring and maintaining your Dojo.
			</span>
			<span className="items-category">MONITORING</span>
			<span className="item">DOJO STATUS</span>
			<span className="item-descr">
				A dashboard for monitoring the health of some components of your Dojo.
			</span>
			<span className="item">PUSHTX STATUS</span>
			<span className="item-descr">
				A dashboard for monitoring the transactions pushed through your Dojo.
			</span>
			<span className="items-category">TOOLS</span>
			<span className="item">PAIRING</span>
			<span className="item-descr">
				Pair your wallet to your Dojo by scanning a QRCode.
			</span>
			<span className="item">XPUBS TOOL</span>
			<span className="item-descr">
				Everything you need to manage your XPUBs manually.
				<br />
				Check if a XPUB is tracked by your Dojo. Import and track a XPUB. Rescan
				the full history of a XPUB.
			</span>
			<span className="item">ADDRESSES TOOL</span>
			<span className="item-descr">
				Everything you need to manage your addresses manually.
				<br />
				Check if an address is tracked by your Dojo. Import and track an
				address. Rescan the full history of an address.
			</span>
			<span className="item">TRANSACTIONS TOOL</span>
			<span className="item-descr">
				Check if a transaction is found in a block or in the mempool of your
				full node.
			</span>
			<span className="item">BLOCKS RESCAN</span>
			<span className="item-descr">
				Force the Tracker to rescan a small range of blocks.
				<br />
				For large rescans you should prefer XPUB or address rescans.
			</span>
			<span className="items-category">HELP</span>
			<span className="item">DOJO TELEGRAM CHAT</span>
			<span className="item-descr">
				Get support from the community for all things related to your Dojo
				(requires Telegram).
			</span>
			<span className="item">SW TELEGRAM CHAT</span>
			<span className="item-descr">
				Get support from the community for all things related to your Samourai
				Wallet (requires Telegram).
			</span>
		</div>
	);
}

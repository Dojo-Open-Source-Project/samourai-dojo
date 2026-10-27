import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiOrigin = process.env.DOJO_ADMIN_API_ORIGIN;
const network = process.env.COMMON_BTC_NETWORK ?? "mainnet";
if (network !== "mainnet" && network !== "testnet") {
	throw new Error(`Unsupported COMMON_BTC_NETWORK: ${network}`);
}
const apiBase = network === "testnet" ? "/test/v2" : "/v2";

export default defineConfig({
	root: import.meta.dirname,
	base: "/admin/",
	define: { __DOJO_ADMIN_API_BASE__: JSON.stringify(apiBase) },
	plugins: [tanstackStart({ spa: { enabled: true } }), react()],
	preview: {
		// Keep the prerender server and fetch on the same loopback address in Docker.
		host: "127.0.0.1",
	},
	server: {
		port: 3000,
		proxy: apiOrigin
			? { "^/(?:test/)?v2(?:/|$)": { target: apiOrigin, changeOrigin: true } }
			: undefined,
	},
});

export const httpConfig = {
	dojoVersion: "test-version",
	db: {},
	bitcoind: { rpc: {} },
	gap: { external: 20, internal: 20 },
	prefixes: { support: "support", statusPushtx: "status", status: "status" },
	auth: {
		activeStrategy: "localApiKey",
		mandatory: true,
		strategies: {
			auth47: {
				hostname: "http://dojo.test",
				paymentCodes: ["allowed-payment-code"],
			},
			localApiKey: {
				adminKey: "configured-admin",
				apiKeys: ["configured-api"],
			},
		},
		jwt: {
			secret: "test-secret",
			accessToken: { expires: 600 },
			refreshToken: { expires: 7200 },
		},
	},
	indexer: { active: "local_bitcoind", localIndexer: {} },
	explorer: { active: null as string | null, uri: null as string | null },
	soroban: { rpc: null as string | null, externalRpc: null as string | null },
};

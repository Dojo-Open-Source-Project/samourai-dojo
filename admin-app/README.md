# Admin app

`npm run admin:dev` serves the maintenance tool at `/admin/`. Set `DOJO_ADMIN_API_ORIGIN` to the origin of a running Dojo nginx server to proxy `/v2` and `/test/v2` requests during development. Set `COMMON_BTC_NETWORK=testnet` to use the testnet API prefix; the default is mainnet. Docker Compose passes this network to the build from the Dojo configuration.

`npm run build` builds TanStack Start in SPA mode and copies its client files to `dist/static/admin`. It writes the same shell to `index.html` and `dmt/index.html` so both existing URLs work through the current nginx and static file setup. The Start server bundle is only used to generate the shell during the build.

The screens are React components in `src/screens`. API reads use TanStack Query and actions use mutations. CSS and icons live in `public` and are served directly by Vite.

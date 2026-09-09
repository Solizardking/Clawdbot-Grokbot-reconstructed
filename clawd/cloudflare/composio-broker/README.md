# Clawd Bot connected-apps broker

This Worker keeps the shared Composio project key out of desktop builds. Each
installation receives a random bearer token stored only as a SHA-256 hash in
D1. The Worker gives that installation its own Composio user/session, proxies
MCP traffic, and returns short-lived Connect Links to the local app.

The desktop never receives the project key. Authorization links are returned
only on demand and are never persisted in chat messages.

Current Worker (account `7640372571bf2d69ed5d58a6a6d8929e`):

- URL: `https://clawdbot-composio.mynameisjeffspicoli.workers.dev`
- Health: `GET /health` → `{ "service": "clawdbot-composio", "ready": true }`
- D1: `clawdbot-composio` (`cc1d4eac-209e-4a84-a2be-4117c6ee97e4`), migration `0001_installations.sql` applied

`COMPOSIO_API_KEY` is a Wrangler secret, not a Git file. Desktop builds that
should use this broker set `OMB_COMPOSIO_BROKER_URL` to the URL above.

Deployment for this repository (npm toolchain from the reconstruction root):

1. `npm install --prefix clawd/cloudflare/composio-broker`
2. `npm run migrate:remote --prefix clawd/cloudflare/composio-broker`
3. For an existing Worker, put `COMPOSIO_API_KEY` with Wrangler's secret command, then `npm run composio-broker:deploy`.
4. For the very first deploy, put `COMPOSIO_API_KEY=...` in the ignored `.dev.vars.production` file and run `npx wrangler deploy --config clawd/cloudflare/composio-broker/wrangler.jsonc --secrets-file clawd/cloudflare/composio-broker/.dev.vars.production`. Delete the file immediately afterward.

Local checks:

```sh
npm run composio-broker:test
npm run composio-broker:dry-run
```

Forks should create their own D1 database and rate-limit namespaces, replace
the IDs in `wrangler.jsonc`, deploy under their own Worker name, and set
`OMB_COMPOSIO_BROKER_URL` in their packaged build. Running only the local
server with a Composio project key remains the no-Cloudflare self-host path.

Set `REGISTRATION_MODE` to `closed` to stop issuing new installation tokens
without affecting existing users.

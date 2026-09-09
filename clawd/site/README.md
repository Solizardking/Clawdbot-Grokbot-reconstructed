# Clawd website

Live preview: https://clawd-desktop-site-8bit.fly.dev

Dedicated Convex project: `jeff-spicoli:clawd-desktop`.

- Production API: `https://hushed-ocelot-930.convex.cloud`
- HTTP actions origin: `https://hushed-ocelot-930.convex.site`
- Dashboard: https://dashboard.convex.dev/t/jeff-spicoli/clawd-desktop/hushed-ocelot-930

This backend is exclusively for the website. The city's `merry-elephant-282` deployment has its own source and must not receive website deployments.

## Develop and deploy

Use Node 24–26. Run `npm ci`, `npm test`, `npm run typecheck` and `npm run build` from this directory. `npm run dev` serves port 3100. Copy `.env.example` to `.env.local` for local configuration; use a separate development Convex deployment and matching JWT issuer when testing local sign-in.

`npm run convex:deploy` reads the private deployment key from the repository's ignored `.cache/clawd-site-credentials/dedicated-convex.env` and refuses a different production deployment. Management tokens and deploy keys belong in private operator storage; the website needs neither at runtime. Only the JWT signing key, rate-limit salt and runtime configuration are imported into Fly secrets. Convex has the public verification key.

Deploy the website with `fly deploy --remote-only --ha=false --depot=false`. The Docker build contains no `.env` files. The public Convex URL is also compiled into the Next build, so changing deployments requires a rebuild.

## Verification

On 2026-09-08, the deployed Fly website passed the signed-login smoke test after the dedicated backend switch. Its ephemeral test account was independently confirmed in `hushed-ocelot-930`. Nine local authentication/download tests and TypeScript checks passed after the mobile wallet update on 2026-09-09.

`/api/health` reports process health. `/api/ready` also verifies authenticated access to Convex. `node scripts/smoke-live.mjs` exercises the public website with a newly generated, unfunded test wallet: message signature, account creation, invalid signature rejection, cross-origin rejection, nonce replay rejection, and session revocation. It creates one test account and never sends a blockchain transaction. Browser wallet-extension approval still requires a wallet-capable browser.

Authentication uses an exact server-generated message, five-minute challenge, browser binding, atomic nonce consumption, seven-day opaque HttpOnly session, and short-lived wallet JWTs. Convex stores only hashed session credentials. Expired challenges, sessions and rate-limit records are removed in bounded cron batches. Account reads enforce wallet identity; trusted service functions require a separate signed service role.

## Launch status

Wallet accounts and download-request tracking are implemented. Download requests are deduplicated per browser, release and day; they do not prove a completed installation. Public releases must be active, signed and notarized, and their destination origin must be explicitly allowed.

Subscriptions and invoices currently have database schemas only. Solana and x402 checkout, settlement verification and desktop entitlement provisioning remain to be implemented and verified. Pricing and a public receiving address are still required. No payment controls are enabled. No release is published until signing and notarization are verified.

## Mobile wallets

The browser registers `@solana-mobile/wallet-standard-mobile` on the client. On supported Android browsers, “Use Installed Wallet” is the default login option. A server challenge is prepared before the click so `solana:signIn` runs directly from the user gesture. The server verifies the returned SIWS message against its exact domain, URI, nonce, chain and signing wallet, then atomically consumes the browser-bound challenge in Convex.

`node scripts/smoke-mobile-live.mjs` verifies this through the deployed website with an unfunded test wallet, including invalid signatures, missing browser cookies, replay and logout. The 2026-09-09 run passed. Android user-agent emulation displayed the default mobile option; real Android wallet approval is still untested. MWA does not provide iOS support or Mac-to-phone pairing through this local Android integration.

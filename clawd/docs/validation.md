# Validate Clawd Bot

Run checks from the standalone Clawd Bot repository root, using `.node-version` and `package-lock.json`. A passing source build does not establish live provider access, signed desktop distribution, phone connectivity, or recovery of historical local data.

## Repeatable source checks

```sh
npm ci
npm run docs:check
npm run publication:check
npm run build
npm test -- --maxWorkers=4
npm run test:integrations
npm run build:bridge
npm run build:service
npm run test:packaged
npm run check:electron
```

`--maxWorkers=4` bounds local CPU/process contention while keeping the full suite and count floor.

`build` includes application typechecking, UI, server, companion, and updater builds. `test:packaged` runs the server without repository dependencies in reach. The optional docs website and native iOS build are separate packages/targets.

The two Worker packages have independent lockfiles. In each of `cloudflare/control-plane` and `cloudflare/composio-broker`, run `npm ci`, `npm run check`, and `npm test`. These are the Worker checks declared by CI; local emulator results are not deployment evidence.

## Isolation first

`vitest.config.ts` must load `server/testing/setup.ts` before application tests. The setup isolates both harness and companion state from the real installation. Never remove it to work around a failure. A September 7 run without the setup damaged local application data; subsequent passing tests do not establish recovery.

For a standalone-install proof, create an export using `npm run publication:export`, place it outside the checkout and parent dependency tree, and run the locked install/build/checks there. Record the exact revision, runtime, command, pass/fail/skip totals, and any follow-up reruns.

## Historical evidence

The earlier September 7 validation record reported an independent Node 24.15.0/npm 12.0.2 export with a successful locked install and build, 2,068 application tests passed and 18 skipped, 51 integration tests passed, and a packaged-server smoke resolving ten proxy paths. It also reported passing Worker checks and 62 Electron syntax checks. These are dated observations, not results from this documentation rewrite.

The local installation-session record (`install-status-2026-09-07.md`, when present) describes a different run with four initial failures and focused reruns, along with unresolved data recovery and connection blockers. Keep those scopes separate rather than combining them into a current all-green claim.

## Release and live acceptance

After source checks, validate the installed desktop and the features being shipped: real inference, credentials, native permissions, phone pairing, and any deployed transport. Mark unavailable credentials or infrastructure as unverified. Follow [release checks](releasing.md), [phone checks](ios-companion.md), and [notification QA](notification-and-proactivity-qa.md) as applicable.

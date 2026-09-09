# Clawd Bot installation record — September 7, 2026

This is a historical record of the September 7 installation session, not a current health report. The installation/connectivity goal was **incomplete** at the end of that session. Hostnames, deployment state, package versions, and connection blockers below have not been re-probed by the documentation rewrite.

Use [validation](validation.md) to repeat source checks and [releasing](releasing.md) for distribution requirements. Preserve the incident and recovery limits when citing this record.

## Installation observations recorded that day

- Standalone Clawd Bot 0.1.37 installed at `/Applications/Clawd Bot.app` from this directory's source and npm lockfile.
- Node 26.5.0 used for the build. UI, server, companion, updater, cloudflared, CUA, Android tools, speech helper, and recorder helper were staged.
- The app is locally ad-hoc signed; deep/strict signature verification passed. It is not notarized.
- The actual desktop UI opened at `http://127.0.0.1:8799/`; `/api/health` returned the matching server PID with `static: true`. UI HTTP status was 200.
- Final installed Electron framework version is 42.4.1. The complete bundle was staged and verified before replacement, avoiding stale resources left by merging app bundles. The final `/api/connectors/connected` response reports `credentialStore: "ok"` and `configured: false`.
- Fresh desktop workspace: `~/Library/Application Support/clawd-bot/workspace`. Explicit `CLAWD_DATA_DIR` and `OMB_DATA_DIR` overrides remain supported.
- Old Grok/reconstructed app processes and the old diagnostic harness were stopped. `Grok Bot.app` and `clawdbot.app` were moved out of `/Applications`, reversibly, to `~/Library/Application Support/Clawd Bot/Previous Installs/20260907-173204/`, with `.disabled` suffixes.
- Telegram full bridge `clawd-grok-telegram-bot` was rebuilt and deployed to its existing single Fly machine. Live health reports `configured: true`, `running: true`, username `clawdnewnewbot`, and no error. Telegram reported no webhook and zero pending updates. No test message was sent.
- The separate `grok-bot-telegram` deployment identifies as `clawdfuckinbot`; it was retained because it is a different bot, not a duplicate consumer.

## Fixes recorded in the session

- Telegram startup now marks an existing environment/stored token configured; the regression test failed before the fix and passes after it.
- The server ESM bundle now supplies `createRequire` for bundled CommonJS dependencies. The isolated packaged-server smoke test previously failed on `require("buffer")`; it now boots without repository dependencies and resolves all ten proxy paths.
- Desktop readiness allows up to two minutes for initial CLI discovery, with bounded individual health requests. Actual discovery took just over the previous 20-second limit.
- Midnight skin now defines its focus-ring color. The companion hostname fixture no longer contains an invalid space.
- Electron is pinned to 42.4.1, which contains the upstream async secure-storage initialization fix: https://releases.electronjs.org/pr/51924 .
- Imported integration checks now reflect the standalone source boundary, without requiring the parent reconstruction's excluded ASAR packaging/renderer scripts. All 51 imported integration tests pass.

## Validation limits

The full isolated unit/contract run counted 2,086 tests: 2,064 passed, 18 were skipped, and four failed. The skin and hostname failures were subsequently fixed and passed their focused rerun (23 tests including the isolation check). Two team-import tests hit the 30-second limit while repeatedly discovering installed CLIs; both passed a focused rerun with a 120-second per-test timeout (91 seconds total). No claim is made that an unchanged full-suite invocation is entirely green. Typechecking passes.

## Data-loss incident — recovery remains unresolved

The app's Vitest configuration omitted `server/testing/setup.ts`. Running `npm test` therefore allowed tests containing recursive cleanup of `DATA_DIR` to target the real `~/.clawdbot` directory. This run deleted much of its contents. The directory measured approximately 2.0 GB before the run and 76 KB afterward. Companion device tests also touched `~/.clawdbot-companion`.

The issue was disclosed during the session. The missing setup file is now registered, and both production data-directory overrides are cleared in test setup. A focused isolation test verifies that server and companion data paths resolve beneath the temporary test directory; it passes. Further tests were run only after this check passed.

No Time Machine destination or APFS local snapshot was available. A filename search of the home directory and attached `ordlibrary 1` volume found an older `.clawdbot-dev/clawdbot.json`, but no complete backup. That development configuration is not a substitute for the deleted data and was not copied over it. Separate `.openclaw`, `.openclawd`, and Grok Bot application-data directories still exist. Recovery is **not** claimed; a user-provided backup is needed for a reliable restore.

## Connection blockers at session end

- `accounts.clawdbot.com` does not resolve. The inherited control-plane config targets account `0c92969a82eb9e173b013a7e7a02333d`, whereas the available credentials access account `7640372571bf2d69ed5d58a6a6d8929e`. The latter has neither Clawd Worker nor the configured D1 databases.
- The inherited Composio Worker URL returns HTTP 404. No Composio API key for this install has been located.
- Cloudflare Email Sending inspection returns `401 / 2036 Unauthorized`. Account login/OTP delivery and managed companion tunnels have not been verified.
- Domain selection is pending. Accessible zones include `chatgptee.ai`, `cheshireterminal.com`, `pumpai.ai`, `solgpt.trade`, and `x402.life`.
- Electron 42.1.0 reported OS secure storage unavailable. After upgrading the installed bundle to 42.4.1, the next launch read the credential store and proceeded to the Composio registration request (which still fails with the inherited endpoint's HTTP 404). The encrypted `credentials.bin` was preserved throughout. macOS may present a Keychain prompt for the updated local signature; computer-use tools cannot inspect SecurityAgent.

The old Cloudflare endpoints are not described as connected. No replacement Cloudflare infrastructure was deployed in that recorded session.

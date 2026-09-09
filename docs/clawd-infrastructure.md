# Clawd Bot hosted infrastructure

This guide covers Clawd Bot and its shared provider infrastructure. Commands
run from the parent repository root unless stated otherwise. Existing Fly app
names (`grok-provider-gateway-8bit`, `grok-runtime-owner-8bit`), `SAND_*` fields,
and provider model IDs are operational identifiers, not product branding.
Dated validation entries below are recorded evidence, not a fresh health check.

Provider credentials are stored as Fly secrets on `grok-provider-gateway-8bit`. Private operator copies are ignored by Git and have mode 0600. Desktop and web clients receive account access, not these provider credentials.

## Updating private infrastructure settings

Run `node scripts/import-clawd-infrastructure.mjs` from the repository root and enter the JSON through its hidden prompt. Partial updates preserve other local settings and stage only the requested changes on Fly. A private lock prevents overlapping imports, the local copy is replaced atomically after successful staging, and failed staging retains the old copy. The directory is mode 0700 and the file is mode 0600; malformed input is reported without its values. Staged secrets take effect on the next Fly deployment.

## Solana Tracker

Configured variables: `SOLANA_TRACKER_SECURE_RPC`, `SOLANA_TRACKER_RPC_URL`, `SOLANA_TRACKER_WSS_URL`, `SOLANA_TRACKER_ACCESS_KEY`, `SOLANA_RPC_URL`, `RPC_URL`, and `ACCESS_KEY`. Keep their values out of build arguments, public environment variables, browser URLs, logs and downloadable configuration.

`POST /solana/rpc` requires a gateway bearer token and the separate `solana` service grant. It uses the configured secure RPC endpoint first, otherwise the Tracker HTTP endpoint. The provider host is validated, redirects are refused, and clients cannot supply an upstream URL. Only the named read methods in `services/provider-gateway/solana-tracker.mjs` are accepted. Batch calls, DAS methods and transaction broadcasts are rejected. Helius indexed asset requests remain on `/helius/rpc` with their existing grant.

Run `node scripts/smoke-clawd-tracker.mjs` using the private owner access file to check authenticated mainnet blockhash and public account balance reads, anonymous rejection and broadcast rejection. All passed on 2026-09-09. Gateway validation tests also cover grants, quotas, endpoint restrictions and sanitized upstream errors.

The supplied WebSocket URL is configured, but the live provider closes it with code 1008 and reason `Connection limit (2) reached`. No existing connection was disconnected. A server-side shared subscription pool still needs implementation; client applications must not receive the credential-bearing WebSocket URL.

## NVIDIA and hosted computers

`NVIDIA_API_KEY` is configured; the live authenticated model catalog returned 80 models on 2026-09-09. A subsequent authenticated chat request to `nvidia/nemotron-3-super-120b-a12b` returned `CLAWD_NVIDIA_READY` with HTTP 200 and a normal stop. The gateway now exposes authenticated `/nvidia/v1/models` and `/nvidia/v1/chat/completions`, backed by that server-held key. NVIDIA requires an explicit per-provider model grant, even for legacy accounts. Existing provider catalogs are enforced for chat requests, preventing a model grant from being spent through another provider.

Nemotron defaults to thinking disabled for bounded normal chat. The gateway translates validated `reasoning.enabled`, `reasoning.effort` (`none`, `low`, `high`) and `reasoning.max_tokens` into NVIDIA template controls; client-supplied raw template overrides are ignored. See [NVIDIA's endpoint reference](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer).

`node scripts/smoke-clawd-nvidia.mjs` passed authenticated catalog, anonymous and cross-provider rejection, ordinary chat, streamed tool calling, Tavily search and sourced final answer on 2026-09-09. Earlier attempts encountered an upstream stream error and HTTP 503; availability is not guaranteed and no automatic retries conceal failures. The installed Mac app now has a separate `hosted-nvidia` engine using the same revocable account token. Its signed server matches the rebuilt source, and a fresh chat returned the requested verification marker. The existing default engine remains unchanged. The installed-app search checks reached Tavily successfully, but NVIDIA returned a streamed `service_unavailable` error (code 503, `Service temporarily overloaded`) during the final answer. This remains an upstream availability limitation; a successful short gateway smoke does not prove reliable long conversations.

The generic OpenAI-compatible chat driver now treats streamed provider errors and missing final answers as failed turns instead of empty successful turns. Twenty client regression checks and 25 gateway/import checks passed after these changes.

E2B is now available in the installed Clawd Computer panel. Select E2B as a bot's cloud backend and choose Cloud, then start its 15-minute desktop. The panel shows timestamped PNG snapshots, refreshes every 30 seconds, and supports an expanded viewer, mouse clicks, text, keys and scrolling while the user holds control. It does not stream video. Starting an explicit Cloud agent turn can also create the desktop; Auto only reuses an existing session. Agent control requires Claude or a compatible ACP engine with computer-tool support. Hosted OpenAI-compatible engines currently support manual panel use only.

The gateway binds each account's single desktop to its bot context. Another bot cannot inspect its screen, act, stop it or claim its reservation. Read-only status inspection does not create a sandbox. Screenshots, status inspection and cleanup do not consume the daily action allowance, but retain per-minute and concurrency limits. Provider keys stay on Fly; the desktop receives no provider credentials. The agent MCP proxy requires a screenshot before actions and resets that observation when control is interrupted. Manual actions require user control, and active sessions block destination changes.

On 2026-09-09, `node scripts/smoke-hosted-desktop.mjs` passed real creation, command execution, PNG capture, cross-bot rejection and cleanup. The installed panel separately opened a terminal by clicking its desktop preview, typed a harmless command, sent Enter and visibly displayed `CLAWD_PANEL_READY`. Expanded viewing and control handoff worked. A fresh installed-app Codex turn then discovered the E2B MCP tools, received the real screenshot, executed `printf CLAWD_AGENT_E2B_READY` after one-time approvals, and returned the exact output with exit code 0. Claude could not complete its separate check because its upstream authentication returned HTTP 401. The Electron MCP process needs `ELECTRON_RUN_AS_NODE=1`; that flag is now included, and the proxy test also passed using the installed app binary. Gateway tests cover migration of pre-existing desktop rows, context isolation and lifecycle behavior; MCP tests cover image output, observation and takeover behavior.

The separate Browser Use task completed and reported the Example Domain heading at example.com. Browser Use is not yet connected to Clawd Bot's main Computer panel.

The Usepod agent is installed locally. Enrollment, pricing, backend selection, bond payment and serving jobs have not been completed.

## Desktop candidate

On 2026-09-09, both Mac architectures passed payload and Developer ID signature checks. The Apple Silicon candidate was installed at `/Applications/Clawd Bot.app` with the previous app backed up and the configuration hash unchanged. The installed server hash matched the verified build, and the application reopened successfully. The E2B update was installed and verified on Apple Silicon; the Intel package still needs rebuilding with these latest changes. Notarization is still outstanding, so these are not public release artifacts.

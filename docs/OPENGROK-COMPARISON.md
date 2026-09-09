# Clawd Bot: OpenGrok reference comparison — 2026-09-05

Clawd Bot’s parent reconstructed desktop runtime was compared with the supplied sibling
`opengrok-main` checkout. This is a comparison of local snapshots, not a claim
about the latest remote release or complete feature parity. The reference is
a model-routing sidecar for an installed app; this repository rebuilds the
app and supplies its own provider sessions, desktop bridges, and packaging.

`manifests/reconstruction/opengrok-reference.json` records SHA-256 hashes and
sizes for all 69 currently present reference files across the requested areas. Reproduce it with
`node scripts/compare-opengrok.mjs /path/to/opengrok-main`. The script also
checks that all 13 requested target directories exist and does not run setup,
modify the reference, or call providers.

The tables describe the parent runtime snapshot. The standalone Clawd Bot app
in `clawd/` has its own build and validation history. OpenGrok is the upstream
reference name; its paths, hashes, authorship, and license attribution are retained.

## Directory coverage

| Target | Reference comparison and verification |
| --- | --- |
| `deploy/`, `deploy/telegram-bridge/` | Full bridge Docker/Fly assets stage with `npm run build:bridge`. Generated server serves health and shuts down on SIGTERM. Container execution requires a running Docker daemon. |
| `dist/` | Rebuilt macOS app, ad-hoc signed; verified 14 clean source runtimes, native payloads, bundle identity, renderer checksum chain, and native startup. |
| `docs/` | Architecture and renderer documentation reconciled with actual packaging; this report records sidecar differences. |
| `frontend/` | TypeScript and Vite build pass. Editable partial renderer; packaged UI uses pinned upstream assets plus Router, Solana, and read-aloud transforms. Reference `assets/` and LiquidGlass HUD are separate presentation assets. |
| `manifests/` | Existing build/provenance inputs retained; added reproducible reference snapshot. Generated package composition and output hashes verified. Historical runner audit is evidence, not a new live parity result. |
| `patches/` | Pinned Connect transport and native build patches applied through `native:patch`; existing digest checks retained. Reference host patchers target different bundles and were not applied. |
| `research-archives/` | Both original installers match `SHA256SUMS`. These preserve original binaries; reference wire captures preserve provider probe evidence and do not replace installers. |
| `scripts/` | Build, package, verification, smoke, publication, and reference inventory exercised. Added a named lightweight service build command. |
| `services/` | Lightweight OpenRouter/xAI Telegram service builds; generated entrypoint serves health and exits cleanly on SIGTERM. It has web tools and explicitly configured model fallbacks, unlike the full bridge's Solana/pump tools. |
| `source/` | Runtime TypeScript passes; fixed Solana type errors, portable startup, Request headers, bridge port validation, and socket shutdown. |
| `src/` | Immutable extracted 0.18 input retained. Packaging checks its provenance rather than substituting sidecar code. |
| `tests/` | 140 tests pass, zero skips. Added behavioral regressions for Request headers, port bounds, socket shutdown, and portable startup; replaced a 60 ms audio-test assumption with bounded completion polling. |

## Relevant reference capabilities

| OpenGrok reference | Clawd Bot parent runtime boundary |
| --- | --- |
| `box/openai-hop-session.cjs`, provider maps | Reference consumes per-agent bindings and shim-specific wire controls. Reconstruction uses native provider sessions and a global Router setting. No binding-file consumer, LiquidGlass fleet HUD, or new GLM/Gemini/DeepSeek mapping was imported. |
| Context Guardian, verified hops, live metrics | Reference-specific pruning, hop receipts, and per-bot telemetry are not equivalent to the reconstruction's tool-step limits and local usage counters. Full sidecar parity is not claimed. |
| `tools/codex-everywhere-bridge.py` | Converts Chat Completions to Responses for an external endpoint. Reconstruction already has a direct Codex Responses transport; it does not provide this separate CE proxy. |
| `voice/` | Reference has streaming xAI STT, an OpenAI realtime brain, ElevenLabs output, and a browser panel. Reconstruction has Telegram voice notes, read-aloud/media tools, and a configurable voice gateway. These are different voice stacks. |
| `setup.py`, `examples/` | Reference setup discovers an installed app and writes sidecar configuration. Reconstruction bootstraps a checksum-pinned runtime and packages a separately identified app; sidecar example bindings are not desktop settings. |
| `CONTRIBUTING.md`, `docs/TESTING.md`, `wire-captures/` | Adopted the emphasis on real negative controls and local fake-upstream checks. Reference captures establish claims about their recorded provider lanes, not every routed model in this app. |
| `LICENSE` | Reference is MIT, copyright OnlyTerp. No reference implementation/assets were vendored; reconstruction NOTICE and provenance remain unchanged. |

## Results and limits

- Node 26.5.0 used from `.cache/node-v26.5.0-darwin-arm64`; the shell originally selected Node 24.15.0. Select the version in `.node-version` for future builds.
- `npm run check`: 140/140 tests and both TypeScript projects pass.
- Frontend, full bridge, and lightweight service builds pass. Vite reports existing static/dynamic import overlap warnings.
- macOS package rebuilt successfully with 6 native manifest entries and 746 unpacked runtime files. `npm run verify` and the bounded isolated-profile native smoke pass, including renderer startup and absence of fatal logs. Native smoke does not prove an authenticated conversation.
- Both generated Telegram entrypoints return HTTP 200 on `/healthz` and exit 0 after SIGTERM with no credentials supplied. Unit tests use fake Telegram/provider responses; no messages were sent to real chats.
- Reference direct maps: 23/23; hop maps: 6/6; all eight box suites pass when run with socket access and Python 3.13 available as `python`; reference CE bridge: 2/2 integration checks. Initial failures were socket restrictions and an unresolved Python shim.
- `publication:check` preserves the committed HEAD tree (2,111 files). It does not include the substantial pre-existing uncommitted work or changes from this audit; it is not proof that those changes have been published.
- Docker was unavailable: the configured Colima socket did not exist. Docker sandbox/container execution, Fly deployment, and live authenticated inference, cloud computers, media, voice, and transaction execution were not validated. No provider credentials were used and no deployments or financial transactions were made.

The existing Solana runtime includes transaction submission and desktop signing;
the old README's statement that no tool can move funds was inaccurate and has
been corrected. This audit fixes compilation and tests local behavior; it does
not certify transaction safety or provider availability.

Detailed local command logs are retained under `.cache/audit-*.log` and are
ignored build evidence. All pre-existing working-tree edits remain uncommitted.

## Subsequent OpenRouter and PayBox update — 2026-09-05

The requested numbered OpenRouter roster is now the default: 13 configured
slots, 11 distinct model IDs, with slot 6 absent. Environment overrides and
saved custom model choices remain supported. `deploy/openrouter.env.example`
records the exact preset without credentials. Live validation found that
OpenRouter accepts at most three entries in `models`; the shared transport
now batches the roster into groups of three on capacity/model HTTP errors,
without restarting the surrounding tool turn. A live request returned HTTP
200 from `minimax/minimax-m3:free`; reported usage was 168 tokens and $0.
An earlier primary-only request timed out, so primary-model availability is
not guaranteed. The full 11-model set was present in the public catalog.

PayBox's three supplied MIT skills are bundled, and its SDK is pinned to
0.8.5. Desktop and Telegram routes discover and execute PayBox tools. Desktop
PayBox secrets are excluded from remote box synchronization. Live discovery
succeeded with 21 remote tools, plus the local status tool. The existing OAuth
login is valid, but no usable signing key is configured; transaction completion
has not been tested. No payments, swaps, card claims, or grant changes were made.
The masked desktop PayBox field accepts the scoped signing key when the user
chooses to enable signing. Advanced MCP-only operations can still require the
PayBox approval/signing interface; no embedded signing window is claimed.

Both TypeScript projects and 149 tests pass. Frontend and both Telegram bundles
build; generated service health endpoints return HTTP 200 and SIGTERM exits 0.
These follow-up checks supersede the earlier test count and statement that no
provider credentials were used. Original artifact/reference comparisons and
Docker/Fly limitations above remain applicable.

The final macOS rebuild passes signature/checksum verification and isolated
native startup smoke, including renderer startup and absence of fatal logs.
The reference inventory was refreshed: `voice/.env.example`, recorded in the
earlier 70-file snapshot, is absent from the current sibling checkout. The
remaining 69 reference files retain their previous hashes. No reference files
were restored or modified.

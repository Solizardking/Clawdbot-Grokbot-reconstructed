# Grok Bot 0.18 — reconstructed and extended

![Animated architecture: local desktop agents connected to inference, cloud computers, and Solana tools](docs/assets/project-flow.svg)

[Quick start](#quick-start) · [Latest changes](#latest-changes) · [Features](#current-features) · [Clawd Bot](clawd/README.md) · [Fly hosting](docs/FLY-HOSTING.md)

<details>
<summary>Desktop Router screenshot</summary>

![Grok Bot Router settings with Codex selected and local usage totals](docs/assets/router-settings.png)

</details>

This repository is an unofficial, source-oriented reconstruction of the
publicly shipped Grok Bot 0.18.0 macOS app, plus the routed-provider,
wallet, Telegram, and tool-surface work already in this tree.

The packaged result is a hybrid macOS application: runtimes compile from
readable TypeScript under `source/`, the checksum-pinned shipped renderer
remains the UI baseline, and a narrow deterministic transform injects the
reconstructed Router, Solana Mode, and Read aloud surfaces. Bootstrap,
package, verify, and test commands turn those sources back into a working
app with a separate bundle identifier and an ad-hoc signature.

This is a hacking and research project, not Anysphere's original monorepo and
not an official Grok Bot release. Names and module boundaries inferred from a
compiled application may differ from the original source.

## Latest changes

This overview reflects the checked-in implementation, including the changes
since the previous README update. Deployment evidence and open verification
items are recorded separately in [Fly hosting](docs/FLY-HOSTING.md).

| Area | Added or improved |
| --- | --- |
| Hosted provider gateway | OpenRouter/xAI streaming with revocable per-user tokens, model allowlists, rate/concurrency limits, and durable SQLite daily request accounting on a Fly volume. |
| Desktop hosted setup | **Settings → Router → Hosted provider** saves the gateway URL/token through the encrypted secret bridge and selects hosted OpenRouter; incomplete hosted configuration fails visibly. |
| Hosted Birdeye | Price and token-overview tools route through per-user gateway access; the operator key is stored on Fly. The configured key currently returns upstream 403 Access Denied. |
| Hosted Solana reads | Granted Helius RPC/DAS reads and service discovery through the gateway; desktop wallet-asset queries need only the user's gateway token. Signing remains local. |
| Hosted Browser Use | Browser creation/stop and agent creation, polling, results, cancellation, and session follow-ups, with persistent resource ownership checks and sanitized task errors. |
| Hosted E2B | One persisted desktop reservation per user; screenshots, input, shell commands, and cleanup through the gateway. Stop remains available after daily quota exhaustion. |
| Cloud hop installer | Provisions checksum-verified Node when missing, transfers compressed hop artifacts, verifies hashes/syntax, and returns the sandbox Node path. Host-consumer binding is still separate. |
| Hosted media | Gateway routes for image generation, speech, and transcription with a `media` service grant and allowed models; bounded responses and no fallback to local provider keys. |
| Runtime fixes | E2B SDK export loading, stopping an unused desktop without creating one, retaining sessions after cleanup failures, preserving command exit codes, and initializing Kernel discovery dependencies. |
| Standalone Clawd | Independent npm install/build, bundled server/companion/updater, isolated packaged workspace, publication checks/export, and validation documentation. |
| Clawd identity and pets | New icon/mascot artwork, state-aware Clawd companion, procedural pet creation, uploaded artwork, validated Codex ZIP import/export, and all 45 SOL-GPT spinner packs. |
| Verification tooling | Focused gateway, ownership, accounting, media, cloud-tool, and pet regressions; resumable browser-agent checks and hosted inference/Solana/E2B/hop smoke scripts. |

### Hosted access without distributing provider keys

The optional [provider gateway](services/provider-gateway/) keeps operator keys
on Fly. Clients receive their own revocable token; `/v1/account` reports only
that user's configured models, service grants, and persistent daily usage.
Supported service grants are `helius`, `browseruse`, `e2b`, and `media`.
Media requests use `/openrouter/v1/images`, `/openrouter/v1/audio/speech`, and
`/openrouter/v1/audio/transcriptions`; their model IDs must also be allowed in
the user policy. Desktop media tools use the hosted URL/token when configured.

Cloud browser and desktop resources are scoped to the requesting user.
Wallet signers and personal CLI credentials remain owner-scoped. The gateway
is a service backend; a public hosted chat website is still separate work.
See [setup, grants, limits, and smoke commands](docs/FLY-HOSTING.md).

### Clawd Bot: standalone agent workspace

[Clawd Bot](clawd/README.md) is the separate local-first React/Electron app in
`clawd/`. It includes CLI-backed agent conversations, team workflows, computer
controls, voice/companion surfaces, connectors, and Solana integrations. Its
full chat server is distinct from the smaller diagnostic harness exposed by
the root `clawd:server` command. Follow the Clawd README for development.

The new **Settings → Pets** library supports nine-pose previews, local creature
generation, PNG/WebP artwork, and Codex pet ZIP import/export. Pet animation
tracks working, streaming, waiting, and offline states, including group
responders; it respects reduced motion and hidden tabs. Custom pets are stored
in IndexedDB, with profile-local selection and spinner preferences.

## What ships today

The reconstruction already includes:

- an inference router for Cursor, Claude Code, Codex, OpenRouter, and xAI;
- a free OpenRouter model roster and OpenRouter response cache;
- PayBox wallets and paid-service tools, with credentials kept in the
  desktop process;
- Grok media tools (image, speech, transcription) and desktop **Read aloud**;
- local `web_search` and `web_fetch`;
- a local-account fallback so Cursor sign-in is not required for other
  router choices;
- a customizable assistant identity (name, persona, standing instructions);
- a live pump.fun launch tape;
- a Kernel cloud-browser attachment;
- Solana Mode (Phantom-hosted or local wallets, Helius reads, Jupiter quotes);
- a desktop Telegram bot plus hosted and lightweight Telegram surfaces;
- E2B cloud-computer and Browser Use tools;
- an optional local Docker sandbox;
- bundled trading skills under `plugins/trading`;
- Open Wallet Standard (OWS) local wallets; and
- a reconstructed updater and telemetry guard on packaged builds.

## What is in the repository?

The checked-in tree contains the reviewed reconstruction, tests, manifests,
build scripts, bundled plugins, deploy assets, and Git LFS preservation copies
of the original macOS arm64 and Windows x64 installers. It deliberately does
**not** commit the extracted upstream application, build output, local
credentials, or the large forensic recovery workspace.

The public Grok Bot 0.18.0 application is a pinned build input. During
bootstrap, the toolchain downloads it, verifies its SHA-256 identity, and
extracts the pieces required to assemble the reconstruction.

The resulting app is a hybrid by design:

- application runtimes are compiled from the readable sources under `source/`;
- the polished shipped renderer remains the UI baseline;
- a narrow deterministic transform adds Router, Solana Mode, and Read aloud;
- original and patched renderer chunk hashes are recorded and verified; and
- the finished app uses a separate bundle identifier and an ad-hoc signature.

The upstream app installed on the machine is never overwritten.

### Product trees

| Tree | Role |
| --- | --- |
| `source/` | Electron main, preload, host, coordinator, local-exec, Telegram bridges, shared contracts, and protocol reconstruction. |
| `frontend/` | Readable React/TypeScript renderer reconstruction and design workspace. Not a pixel-perfect replacement for the packaged renderer. |
| `scripts/` | Bootstrap, compilation, renderer patching, packaging, signing, and verification. |
| `tests/` | Focused Node regressions for router, packaging, tools, wallets, and Telegram surfaces. |
| `plugins/` | Bundled PayBox skills (`plugins/paybox`) and trading skills (`plugins/trading`). |
| `services/` | Hosted provider gateway (`services/provider-gateway`) and lightweight Telegram web-tool service (`services/telegram-fly`). |
| `deploy/` | OpenRouter env preset and Fly assets for the hosted Telegram bridge. |
| `docs/` | Architecture, publishing, and comparison notes. |
| `research-archives/` | Git LFS copies of the pinned 0.18.0 installers and their manifest. |
| `manifests/` | Reconstruction binding, renderer-closure, and runner-parity manifests consumed by the build. |
| `patches/` | Third-party package patches applied at install time. |
| `clawd/` | Clawd Bot product surface, harness server, and Cloudflare Workers (Better Auth control plane plus Composio broker). |

Generated and ignored working trees — `.build/`, `.cache/`, `dist/`,
`node_modules/`, and `src/app/dist` — are build outputs or extracted inputs,
not authored product source. `recovered/`, `recovery/`, and local probe roots
are also ignored.

### Why retain the shipped renderer?

The distributed application did not include the original frontend source or
source maps. It contained optimized, minified production JavaScript and CSS
chunks: enough to inspect behavior and recover contracts, but not the authored
React components, names, comments, file structure, or design-system source.

Recreating the complete frontend with the same polish and behavior would have
been a separate, much larger reverse-engineering project. The practical choice
was to reconstruct the runtime and control-plane code, retain the
checksum-pinned shipped renderer, and make the smallest auditable UI patch
needed for Router, Solana Mode, and Read aloud.

`frontend/` is a readable partial reconstruction and design workspace. It is
useful for understanding UI contracts and experimenting with clean components,
but it should not be mistaken for Anysphere's missing original frontend source
or a pixel-perfect replacement for the packaged renderer.

## Preserved original installers

Research copies of the exact 0.18.0 installers live under
`research-archives/original/0.18.0/` and are stored with Git LFS:

| Platform | File | SHA-256 |
| --- | --- | --- |
| macOS arm64 | `macos-arm64/Grok_Bot_0.18.0.dmg` | `a253ccd8aab01e083f9812a0264354c5034d8ba7f0610bbb557e82ae77d203eb` |
| Windows x64 | `windows-x64/Grok_Bot_0.18.0_Setup.exe` | `464079a15ef5fa8b61ccea8fffcc78f63cfcf6df65fb0ad5e725d8b95f7e437e` |

See [research-archives/README.md](research-archives/README.md) for source URLs,
sizes, verification commands, and the machine-readable artifact manifest.

## Current features

### Inference Router

Open **Settings → Router** to choose the backend used for new turns:

| Provider | Authentication | Tool support |
| --- | --- | --- |
| Cursor | Existing Grok Bot/Cursor session | Native Grok Bot tools and plugins |
| Claude Code | Existing Claude Code login | Routed Grok Bot MCP tools |
| Codex | Existing local ChatGPT/Codex login | Direct Responses transport with Grok Bot tools |
| OpenRouter | API key saved through the desktop secrets bridge | Grok Bot tool-execution loop |
| xAI | API key saved through the desktop secrets bridge (`XAI_API_KEY`) | Grok Bot tool-execution loop |

### Free open models via OpenRouter

The OpenRouter route defaults to `nvidia/nemotron-3-ultra-550b-a55b:free`
with the requested ordered free-model roster. Set `OPENROUTER_API_KEY` in the
environment or Settings → Router. See [the complete preset](deploy/openrouter.env.example)
for `OPENROUTER_MODEL` and numbered fallback variables (slot 6 is intentionally
absent; repeated IDs are attempted once).

OpenRouter receives up to three candidates in its native `models` field.
On capacity/model HTTP errors, the transport advances to the next group.
The app does not replay an entire tool turn to try another model. A custom
model saved in Settings overrides the default roster; environment variables
win over the saved model. `openrouter/free` remains an explicit option.
Free-model availability and rate limits depend on OpenRouter.

### PayBox wallets and paid services

PayBox tools are available to routed desktop conversations and both Telegram
runtimes. The desktop keeps PayBox credentials in its own process and excludes
them from remote box secret synchronization. The three bundled PayBox skills
cover grants, payment units, recipient checks, and x402 costs.

Run `npm run paybox:login`, then `npm run paybox:status`. If signing is not
ready, save the scoped signing key in **Settings → Router → PayBox** or set
`PAYBOX_SIGNING_KEY` in the process environment. Never enter it in chat.
An optional `PAYBOX_API_KEY` can replace local OAuth. Hosted processes need
their own credentials; desktop credentials are not deployed automatically.

Tools are discovered from PayBox with their current schemas. The pinned SDK
handles supported headless signing operations; advanced MCP-only operations
can require PayBox's approval/signing interface. Pending approval is not a
completed payment. See [PayBox setup and limitations](plugins/paybox/README.md).

### Direct xAI routing

Pick **xAI** on the Router page (or `export XAI_API_KEY=xai-...` before
launch) to route turns straight at `api.x.ai/v1` with your own xAI key —
no OpenRouter middleman. The default model is `grok-4.6`; set **Model** on
the Router page or `SAND_XAI_MODEL` to pin another xAI model (e.g.
`grok-4-fast`). All routed tools (web search/fetch, Grok media, Solana,
pump.fun tape) work identically on this route.

### Grok media tools (image, speech, transcription)

Every routed turn also gains three local tools backed by OpenRouter's dedicated
media endpoints, using your existing OpenRouter key:

| Tool | Purpose | Endpoint | Default model |
| --- | --- | --- | --- |
| `grok_imagine` | Generate an image from a prompt and save it locally (optional aspect ratio, resolution 1K/2K, quality low/medium) | `POST /api/v1/images` | `x-ai/grok-imagine-image-2.0` |
| `grok_speak` | Synthesize speech from text and save an mp3/wav/pcm file (optional voice, e.g. `flux-alexis-en`) | `POST /api/v1/audio/speech` | `deepgram/flux-tts:free` (zero cost) |
| `grok_transcribe` | Transcribe a local audio file (wav/mp3/flac/m4a/ogg/webm/aac) to text | `POST /api/v1/audio/transcriptions` | `x-ai/grok-stt-1.0` |

Generated files land under `<data root>/generated/`; tool results report the
saved paths so you can find them in Finder. Speech defaults to OpenRouter's
free `deepgram/flux-tts:free` model, so saying things aloud costs nothing; the
models are overridable with environment variables:

```sh
export OPENROUTER_API_KEY=sk-or-v1-...        # required
export OPENROUTER_VOICE=deepgram/flux-tts:free  # optional free TTS pin (default)
export OPENROUTER_GROK_MODEL=x-ai/grok-4.6   # optional chat model override
export OPENROUTER_GROK_IMAGINE=x-ai/grok-imagine-image-2.0
export OPENROUTER_GROK_VOICE=x-ai/grok-voice-tts-1.0   # paid xAI alternative
export OPENROUTER_GROK_STT=x-ai/grok-stt-1.0
```

`OPENROUTER_VOICE` wins over `OPENROUTER_GROK_VOICE`; both accept any
OpenRouter TTS model id (e.g. a `:free` variant for zero-cost speech).

The tools appear for every routed provider (OpenRouter, Claude Code, Codex)
and on the Telegram bridge whenever an OpenRouter key is configured; ask for
"a picture of …", "say this out loud", or "transcribe this recording" and the
bot picks the matching tool.

**Read aloud in the desktop app**: every agent message's *More message actions*
menu gains **Read aloud**, which speaks the reply through the same free
OpenRouter TTS chain (`OPENROUTER_VOICE` pin, else `deepgram/flux-tts:free`)
right in the app — no extra key beyond `OPENROUTER_API_KEY`. Flux voices are
chosen automatically (`flux-alexis-en` default) or pass your own with the tool
call.

### Internet access (web search & page reader)

Routed turns are also online by default, with no extra keys:

| Tool | Purpose |
| --- | --- |
| `web_search` | Search the public web; returns titles, URLs, and snippets. Tries Bing RSS first, then Mojeek, then DuckDuckGo HTML. |
| `web_fetch` | Fetch a URL and return readable plain text (HTML/scripts stripped, long pages truncated to ~24k chars). |

Both run locally in the coordinator process. Private-network hosts
(localhost, 127/8, 10/8, 192.168/16, link-local) are refused by `web_fetch`,
and only http(s) is allowed. Ask *"what's the latest on …?"* or paste a link
and ask for a summary.

For heavier browsing (clicking, forms, JS-heavy pages), attach **Kernel** or
**Browser Use** keys (see below), or plug any MCP web-search server into the
in-chat AddMCP connector.

OpenRouter is the default route (with the configured free-model roster),
so the app works without any Cursor sign-in. Cursor, Claude Code and Codex do
not require separate API keys
when their local clients are already authenticated, and none of the routed
choices force a Cursor sign-in (see below). The application preserves
streaming responses, thinking state, reactions, rich plugin mentions, and MCP
tool execution across routed conversations.

**Usage & Billing** shows the locally recorded request and token totals for
providers that return usage data. These figures are activity records, not an
authoritative provider invoice.

### Running without a Cursor account

Cursor sign-in is only required by the Cursor router choice. When the routed
provider in **Settings → Router** is Claude Code, Codex, or OpenRouter and no
Cursor session is stored, the app starts under a deterministic local account
instead of blocking on the sign-in screen:

- real Cursor sessions always win once they exist, and signing in from
  **Settings → Account** still works at any time;
- token-backed features (profile, usage dashboards, transcription, plugins
  that call the Cursor backend) degrade gracefully without a session;
- the remote computer still needs Cursor credentials, so select **Use local
  Docker VM** on the Router page for fully local operation;
- set `SAND_FORCE_CURSOR_LOGIN=1` to restore strict Cursor sign-in behavior.

### OpenRouter response caching & router metadata

The OpenRouter route instruments its own transport, so every request opts into
[router metadata](https://openrouter.ai/docs/guides/features/router-metadata)
(`X-OpenRouter-Metadata: enabled`). What the router actually did — which
provider served the turn, the strategy, retry attempts, and whether the reply
came from cache — is captured from each response and shown under
**Settings → Router → Usage → Last route**.

**Response cache** (Settings → Router, visible when OpenRouter is selected)
opts identical requests into [OpenRouter response
caching](https://openrouter.ai/docs/guides/features/response-caching) via
`X-OpenRouter-Cache` with a configurable TTL (1–86400 s, default 300). Cache
hits are free and return instantly; any parameter change produces a new cache
key. The toggle and TTL persist in local settings and apply to routed chat,
the Telegram bridge, and tool-calling turns alike.

### Customize your assistant

**Settings → Router → Assistant identity** lets you shape how the bot behaves
on every routed turn (OpenRouter, Claude Code, and Codex alike, including the
Telegram bridge):

| Field | What it does |
| --- | --- |
| **Name** | What the assistant calls itself; overrides the default product name. |
| **Persona** | Personality and voice that should shape each reply. |
| **Custom instructions** | Standing rules applied to every reply. |

Values are stored in the local settings file, sanitized and size-capped
(60 / 600 / 4000 characters), and injected into the routed system prompt on
the next turn — no restart needed. Clearing a field reverts that part to the
default.

### Live pump.fun launch tape

Routed turns get four built-in read-only tools backed by the same WebSocket
relay that powers `solgpt.us/pump` (`wss://clawd-ws.fly.dev/ws`):

| Tool | Purpose |
| --- | --- |
| `pump_recent_launches` | Newest launches from the live tape (optional `limit`) |
| `pump_search_launches` | Substring search over name/symbol/mint/description |
| `pump_token_enrichment` | Price, market cap, liquidity, holders per mint |
| `pump_relay_status` | Relay health and counters |

Ask things like *"what just launched on pump.fun?"* or *"search launches for
…"* on any routed provider. Override the relay with `SAND_PUMP_WS_URL` /
`SAND_PUMP_HTTP_URL`. For deeper token analysis you can also attach your own
SOLGPT MCP (`https://solgpt.us/api/mcp`, Bearer `solgpt_sk_…`) via the in-chat
AddMCP connector; note that remote plugin execution rides the Cursor backend,
while the four tape tools above work fully locally.

### Cloud browser via Kernel

Paste a [Kernel](https://kernel.sh) API key under **Settings → Router →
Cloud browser** (or `export KERNEL_API_KEY=...` before launching) and every
routed turn gains the bot's own cloud computer, bridged live from Kernel's
MCP server (`mcp.onkernel.com`): create/delete Chromium sessions, drive them
with screen/mouse/keyboard computer actions or Playwright code execution,
run shell commands inside the VM, record replays, and open the live view URL
returned by `kernel_manage_browsers`. Tool names are prefixed `kernel_`
(e.g. `kernel_manage_browsers`, `kernel_computer_action`,
`kernel_execute_playwright_code`) and are discovered dynamically, so new
Kernel capabilities appear without app changes.

### Solana Mode

The shipped UI gains a 🦀 **Solana Mode** panel (toggle it from the injected
switch; enabling it also applies the "Clawd Bot" skin). Configure it once and
both chat turns and your Telegram bridge gain read-only Solana awareness:

| Secret | Purpose |
| --- | --- |
| `PHANTOM_ORGANIZATION_ID`, `PHANTOM_APP_ID`, `PHANTOM_API_PRIVATE_KEY` | Phantom Server SDK access for creating hosted wallets |
| `HELIUS_API_KEY` | Helius mainnet RPC/DAS; `HELIUS_RPC_URL` is derived from this key when unset |
| `HELIUS_RPC_URL` | Canonical Solana RPC for every mint, register, delegate, DAS, and submit path |

The panel can create Phantom-hosted wallets or generate local Ed25519
keypairs (encrypted with OS secure storage), lists every saved wallet with its
public address, and answers portfolio questions via Helius DAS
(`getAssetsByOwner`, `searchAssets`, `getAsset`). These portfolio lookups are
read-only. The current runtime also includes Helius RPC, Jupiter quote,
signed-transaction submission, and desktop wallet swap tools. Submission and
swap tools can move funds; hosted swaps fail when no local wallet signer is
available. Private key material is handled by the local signing implementation.

When `HELIUS_RPC_URL` (or a derived Helius URL) is configured, routed turns
also gain Metaplex agent tools that mint, read, and operate agents on that
same RPC — never `api.mainnet-beta.solana.com`:

| Tool | Purpose |
| --- | --- |
| `solana_agent_mint` | Metaplex API mint + identity register; sign locally; submit via Helius |
| `solana_agent_read` / `solana_agent_search` | DAS `getAsset` / `searchAssets` with `isAgent` |
| `solana_agent_register_executive` | One-time executive profile PDA per wallet |
| `solana_agent_delegate_execution` | Link an agent to an executive |
| `solana_agent_verify_delegation` | `getAccountInfo` on the derived delegate PDA |
| `solana_agent_revoke_execution` | Close the delegate record |
| `solana_agent_launch_token` | Genesis bonding-curve token from the agent PDA |

Point `CLAWD_GATEWAY_URL` (default `http://127.0.0.1:15888`) at a running
Clawd Gateway to add `clawd_gateway_status`, `clawd_gateway_solana_balances`,
and `clawd_gateway_quote`. Requests include `x-helius-rpc-url` so the
gateway and the app share the same Helius cluster.

### Open Wallet Standard wallets

The desktop Trading panel can create locally encrypted Open Wallet Standard
wallets. Routed tools never see passwords or private keys:

| Tool | Purpose |
| --- | --- |
| `ows_wallet_create` | Open a pending create request; the user types the password in the masked Trading-panel field. |
| `ows_wallet_list` | List saved wallets and public chain addresses only. |
| `ows_wallet_requests` | Show whether a request is awaiting a password or has been created. |

KDF work runs in a local worker. Passwords travel only in that worker message,
never in process arguments, environment, or tool results. Never send a wallet
password in chat.

### Bundled trading skills

`plugins/trading` ships Cheshire, Clawd, DFlow, Helius, Imperial, and pump.fun
Agent Skills (plus their `references/` and `scripts/` support files). Routed
turns discover them with `bundled_skill_list` and `bundled_skill_read`; PayBox
skills stay in `plugins/paybox`. See [the trading plugin note](plugins/trading/README.md).

### Bring your own Telegram bot

The app runs **your own** Telegram bot locally. Open **Settings → Router →
Your own Telegram bot**, create a bot with [@BotFather](https://t.me/BotFather),
paste its token, and hit **Save & start** (the token is stored under the
`TELEGRAM_BOT_TOKEN` secret; you can also set `TELEGRAM_BOT_TOKEN` before
launch). The card shows live bridge status and Start/Stop controls. Every
message sent to your bot is answered by the Router selection — OpenRouter free
models by default — with local tools available to that surface:

- Solana wallet/asset lookups (`solana_list_wallets`, `solana_wallet_assets`,
  `solana_asset_get`, `solana_assets_search`, all read-only via Helius);
- the four live pump.fun tape tools.

Built-in commands never burn inference: `/start` and `/help` explain the bot,
and `/status` reports connection state and handled-message counts. Replies are
clamped to Telegram's 4096-character limit; turn failures surface as a friendly
"Router error" reply. The token lives in the OS-protected secret store, the
poll loop long-polls `api.telegram.org` with exponential backoff, and stopping
the bridge (or quitting the app) tears everything down cleanly.

#### Voice notes (free via OpenRouter, or Deepgram)

The bridge speaks, too — and spoken replies are free with just an OpenRouter
key:

- **Free voice, no extra key**: with `OPENROUTER_API_KEY` set (secret store,
  environment, or `fly secrets set`), `/voice` works out of the box through
  OpenRouter's zero-cost `deepgram/flux-tts:free` model. Pin another TTS
  model with `OPENROUTER_VOICE=deepgram/flux-tts:free` (or any other
  OpenRouter speech id).
- **Incoming voice notes and audio files** are downloaded through the Bot API
  and transcribed with Deepgram Nova-3 (`smart_format` on; needs a
  `DEEPGRAM_API_KEY` secret) and answered like any other message — captions
  are honored when present.
- **`/voice`** toggles spoken replies for that chat: answers are also
  synthesized (OpenRouter free TTS by default, or Deepgram Aura
  `aura-2-thalia-en` OGG/Opus when only a Deepgram key is present) and
  delivered as a voice note alongside the text. `/status` shows per-chat
  voice state and which speech services are live.
- An explicit `OPENROUTER_VOICE` pin wins over Deepgram for replies; without
  it, a configured Deepgram key keeps its existing Aura behavior.
- The realtime **voice gateway** defaults to the Cheshire/Clawd LiveKit
  deployment (`https://cheshire-clawd-livekit-grok-crimson-bush-9215.fly.dev`)
  and can be overridden with `SAND_VOICE_GATEWAY_URL`; it is reported in
  `/status` as the designated endpoint for duplex sessions.

#### Hosted full bridge and lightweight Telegram service

Two headless Telegram targets exist. They are not interchangeable.

**Hosted full bridge** (`npm run build:bridge`) stages
`source/telegram-bridge-server` into `.build/telegram-bridge` with the
Dockerfile and `fly.toml` from `deploy/telegram-bridge`. The bot answers even
when the desktop app is closed:

```sh
npm run build:bridge                                   # bundle + stage deploy assets
cd .build/telegram-bridge
fly apps create clawd-grok-telegram-bot --org personal
fly secrets set TELEGRAM_BOT_TOKEN=... OPENROUTER_API_KEY=...
# optional: pin the free voice model explicitly (default is already free)
fly secrets set OPENROUTER_VOICE=deepgram/flux-tts:free
fly deploy -a clawd-grok-telegram-bot                  # keep exactly one machine
curl https://clawd-grok-telegram-bot.fly.dev/healthz   # live status JSON
```

The machine exposes `GET /` (keepalive "OK") and `GET /healthz` (status JSON,
never leaking the token). Secrets come from machine environment only; wallet
creation stays desktop-only, while pump tape and read-only Solana tools work.
Telegram allows a single `getUpdates` consumer per bot — run either the hosted
machine or the desktop bridge at one time, or they will fight with 409s.
Desktop autostart can be disabled with `SAND_TELEGRAM_AUTOSTART=0`.

**Lightweight Telegram service** (`npm run build:service`) builds
`source/services/telegram-fly` into `services/telegram-fly/dist` for a smaller
Fly machine (`services/telegram-fly/Dockerfile`). That surface exposes
`web_search` / `web_fetch`, PayBox tools, and bundled trading skills — not the
full desktop Solana/pump/voice stack.

### Cloud computer & browser (E2B + Browser Use)

Routed turns can also reach outside the box entirely. Paste keys in
**Settings → Router → Cloud computer & browser** (or export them as
environment variables) and the matching tools appear for every routed
provider — no box, Docker, or Cursor credentials involved:

| Key | Tools | What the agent gets |
| --- | --- | --- |
| `E2B_API_KEY` | `e2b_computer_*` | **Our own box** — a sandboxed Ubuntu desktop in E2B: screenshots, mouse clicks, typing, keyboard chords, scrolling, drag, shell commands, plus a browser-viewable VNC stream URL (`e2b_computer_status`). |
| `BROWSER_USE_API_KEY` (or legacy `BROWSERUSE_API_KEY`) | `browseruse_*` | **Our own computers** — a stealth Browser Use cloud agent it can delegate whole web tasks to (`browseruse_run_task`, status/result/follow-up), or raw Chromium sessions over CDP (`browseruse_launch_browser`, `browseruse_stop_browser`). |

`cloud_box_doctor` reports which of those keys (plus Helius and Clawd Gateway)
are ready. `cloud_box_install_hop` copies the OpenGrok hop session from
`box/openai-hop-session.cjs` onto the live E2B desktop. See
[docs/opengrok/README.md](docs/opengrok/README.md).

Keys are stored through the same encrypted desktop secrets bridge as the
OpenRouter key and are pushed to the coordinator automatically. E2B and Browser Use also support the hosted gateway URL/token with the
corresponding service grants, so raw provider keys are optional on the client.
Hosted E2B uses screenshots rather than exposing a direct VNC stream.
The E2B desktop boots lazily on first use, keeps itself alive while the turn
runs, and is destroyed with `e2b_computer_stop`.

### Local Docker sandbox

The Router page also has a **Use local Docker VM** toggle. When enabled, Grok
Bot runs its box host and execution daemon in an owned local container instead
of connecting to the remote sandbox.

The container:

- is bound only to loopback ports;
- mounts content-addressed host and daemon artifacts read-only;
- reuses the user's existing provider authentication where needed;
- is validated before the coordinator connects; and
- is stopped or replaced through the same settings lifecycle.

Docker Desktop, or another compatible local Docker daemon, must be running.
Remote mode remains the default.

### Reconstructed updater and telemetry guard

Packaged reconstruction builds disable the upstream updater at the packaging
boundary (`SAND_DISABLE_UPDATES=1` is forced) and default Sentry and telemetry
emission off (`SAND_DISABLE_SENTRY` / `SAND_DISABLE_TELEMETRY`). An ambient
`SAND_DISABLE_UPDATES=0` cannot let the official updater replace this pinned
0.18 client. Explicitly supplied environment configuration is still respected
for Sentry and telemetry.

## Requirements

For shared provider access with keys kept on Fly, see
[Fly hosting and provider secrets](docs/FLY-HOSTING.md). The dedicated gateway
supports OpenRouter/xAI chat streaming with individual user tokens; the
desktop and local tools remain on the user's computer.

- macOS on Apple Silicon
- Node.js 26.5.x
- Xcode Command Line Tools
- Git LFS
- Docker Desktop (optional, only for the local sandbox)
- local Claude Code or Codex authentication for those router choices

## Quick start

```sh
git clone <your-repository-url>
cd grok-bot-0.18-reconstructed
git lfs install
git lfs pull
npm ci
npm run bootstrap
npm run check
npm run package
open "dist/Grok Bot 0.18 Reconstructed.app"
```

`npm run bootstrap` first uses the Git LFS preservation copy of the pinned
0.18.0 DMG. If that archive is absent, it falls back to the original public URL;
`GROK_BOT_018_APP` can also point to an existing application copy. Bootstrap
verifies both the DMG and `app.asar`, caches the matching Electron runtime, and
hydrates the ignored `src/app/dist` build input.

`npm run package` compiles the reconstructed runtimes, applies the narrow
renderer/settings transform, creates the app bundle, assigns the reconstructed
bundle identity, ad-hoc signs it, and verifies the result. Output is written to:

```text
dist/Grok Bot 0.18 Reconstructed.app
```

`npm test` runs the focused `tests/*.test.mjs` suite. `npm run verify` checks
an existing packaged app. `npm run check` runs typecheck plus that test suite.

## Architecture

```text
polished shipped renderer
          │
          │ desktop preload / RPC
          ▼
     Electron main
          │
          ├── settings, secrets, auth, wallets, plugins
          ├── remote box connector
          └── owned local Docker connector
                       │
                       ▼
              coordinator + host
                       │
              inference router
     ┌─────────┬───────┼────────┬────────┐
  Cursor  Claude Code  Codex  OpenRouter  xAI
                       │
                 Grok Bot MCP tools
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for more detail.

## Development commands

```sh
npm test                  # focused regression tests
npm run typecheck         # renderer TypeScript
npm run source:typecheck  # runtime TypeScript
npm run frontend:build    # build the readable renderer reconstruction
npm run build:bridge      # stage the full hosted Telegram bridge
npm run build:service     # build the lightweight Telegram web-tool service
npm run gateway:start     # run the configured provider gateway
npm run gateway:issue-user # issue a user token/policy entry
npm run gateway:deploy    # deploy the separate Fly gateway
npm run compare:opengrok  # inventory the sibling opengrok-main reference
npm run package           # build, sign, and verify the macOS app
npm run verify            # verify an existing packaged app
npm run smoke             # bounded native smoke check
npm run publication:check # prove a fresh-history export is lossless
npm run clawd:typecheck   # Clawd Bot TypeScript
npm run clawd:build       # Clawd Bot UI
npm run clawd:server      # Clawd Bot harness on 127.0.0.1:8799
npm run control-plane:check
npm run control-plane:test
npm run control-plane:dry-run
npm run composio-broker:test
npm run composio-broker:dry-run
```

## Project status

The [2026-09-07 hosting notes](docs/FLY-HOSTING.md) record live checks for
streaming inference, accounting across restart, Helius reads, Browser Use
browser lifecycle, E2B screenshots/cleanup, and hop installation. They also
record an unresolved Browser Use answer-accuracy assertion. Hop installation
does not establish a running host consumer; Kernel hosting, hosted transaction
submission, and a signed-in desktop conversation remain unverified there.
The latest hosted-media changes have regression coverage; this README does
not claim a fresh live media check or deployment verification.


The app launches and the core reconstructed flows are usable, including routed
inference, connected plugins, Telegram surfaces, wallets, and the local Docker
sandbox. This is still an experimental reconstruction: it targets one pinned
macOS/arm64 release, depends on external provider sessions, and does not
promise compatibility with future Grok Bot versions.

For changes, read [CONTRIBUTING.md](CONTRIBUTING.md). For the clean-history
export procedure, see [docs/PUBLISHING.md](docs/PUBLISHING.md). Technical
provenance and retained upstream boundaries are described in
[PROVENANCE.md](PROVENANCE.md) and [NOTICE.md](NOTICE.md).

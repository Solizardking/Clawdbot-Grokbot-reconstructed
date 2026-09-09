# Use OpenCode with Clawd Bot

OpenCode is an optional CLI-backed engine. Clawd Bot starts `opencode acp` and uses its shared ACP runtime for conversations, tools, permissions, resume, and cancellation. The internal driver kind remains `opencodeGo` so existing bot configurations keep working; the UI name is **OpenCode**.

## Setup

Install the maintained CLI using the [OpenCode installation guide](https://opencode.ai/docs/), then connect providers in OpenCode or run:

```sh
opencode auth login
opencode models --verbose
```

If npm reports that OpenCode's required postinstall script was blocked, finish the same installation with `npm install -g opencode-ai --allow-scripts=opencode-ai`. This grants that package's install script for this invocation; verify `opencode --version` and `opencode acp --help` afterward.

Refresh the engine inventory in Clawd Bot (or restart it) and select an available OpenCode model. Availability can come from an explicit `OPENCODE_API_KEY`, an existing OpenCode login, or a successful usable-model probe. Free or anonymous offerings depend on the installed CLI and provider; they are not a fixed Clawd Bot entitlement.

An optional key saved through Connections is write-only to the UI and passed to the OpenCode child process. OpenCode owns `auth.json`; Clawd Bot reads login presence without rewriting that authentication file.

## Catalog and model selection

Discovery runs the configured binary's `opencode models --verbose`. It preserves exact `provider/model` identifiers, including configured third-party providers and local endpoints. A failed refresh uses the last successful catalog, then a small fallback. Discovery alone does not validate inference or billing access.

Before prompting, ACP selects the model using `session/set_config_option` with `configId: "model"`. Legacy preview model IDs may be normalized by the adapter.

## Local injected models

Selecting an injected local model is a separate configuration path: `ensureOpenCodeInjectModel` can add or update that host's provider and model in OpenCode's `opencode.json`, then return its native `host/model` ID. It may persist the configured host API key in those provider options. This differs from ordinary login discovery; inspect the target configuration before using this path on a shared machine. It does not rewrite `auth.json`.

## Permission decisions

OpenCode's [permission configuration](https://opencode.ai/docs/permissions/) determines which tool calls reach Clawd for approval. Clawd answers each surfaced request with a one-time decision; it does not select session-wide `allow_always` or `reject_always` options. If the CLI offers no matching one-time option, Clawd cancels the request and reports that it could not apply the requested decision.

## Verification

```sh
npx vitest run server/drivers/acp/opencode-go.test.ts server/drivers/acp/acp.test.ts
```

The fake CLI covers protocol behavior without a subscription. A credentialed smoke must separately confirm a real reply, model selection, tools, approval, resume, and cancellation. Keep credentials and raw authenticated protocol logs out of test output.

Source: [OpenCode adapter](../server/drivers/acp/opencode-go.ts). Older Go-only designs are retained in [the planning archive](plans/README.md); the CLI-derived catalog described here takes precedence.

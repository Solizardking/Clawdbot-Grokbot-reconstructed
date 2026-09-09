# Clawd Bot plan: OpenCode integration

Historical integration plan, updated to distinguish the original Go-only proposal from the implemented general OpenCode adapter. Current setup is in [Use OpenCode](../opencode-go.md).

## Product contract

Run the maintained OpenCode CLI through ACP stdio. Reuse Clawd Bot's sessions, event streaming, tools, permissions, cancellation, and MCP integration. Keep the engine optional and preserve saved configurations using the internal `opencodeGo` driver kind.

OpenCode owns provider authentication. Clawd Bot may supply a write-only project key to the child environment and inspect existing login presence. It must not expose credentials through public configuration status, arguments, logs, or error payloads.

## Changes from the original proposal

The original plan proposed querying a public Go-only model endpoint and requiring a Go key. Current [adapter code](../../server/drivers/acp/opencode-go.ts) discovers models from the configured CLI, accepts its existing provider logins or usable-model probe, and supports provider-qualified IDs beyond Go. The user-facing name is OpenCode.

The injected-local-model path can update OpenCode's `opencode.json` provider configuration, including host credentials. Ordinary auth discovery does not rewrite `auth.json`. Keep that distinction in privacy and setup documentation.

## Implementation sequence for future maintenance

1. **ACP contract:** preserve initialization, session creation/load, exact model selection, prompt, streaming, and terminal cleanup order.
2. **Catalog:** run the configured executable, validate model IDs, retain the last successful catalog, and fall back without breaking other engines.
3. **Credentials:** limit supplied keys to the intended child; expose only configured status to the renderer. Cover local injection separately.
4. **UI:** preserve availability states, optional setup, engine icon, and model picker behavior without selecting an unusable engine by default.
5. **Validation:** fake-CLI coverage first; a credentialed smoke separately proves current provider access.

## Required regression coverage

Test missing CLI, missing/invalid authentication, subscription/quota/region failures, catalog outage, malformed output, and fallback caching. Preserve exact IDs across model selection and resume. Cover permission allow/deny/unavailable options, cancellation, concurrent-session isolation, early exit, and malformed JSON-RPC without duplicate final text.

```sh
npx vitest run server/drivers/acp/opencode-go.test.ts server/drivers/acp/acp.test.ts
npm run typecheck
```

For runtime changes, follow with `npm test` and `npm run build`. Live checks require an explicitly configured account and should record outcomes without raw authenticated protocol logs.

## Deferred scope

A direct HTTP API adapter, OpenCode server lifecycle, automatic CLI installation, subscription purchase, billing management, and support for the archived Go-language project are outside this ACP integration. Source tests cannot prove every advertised model works on every account.

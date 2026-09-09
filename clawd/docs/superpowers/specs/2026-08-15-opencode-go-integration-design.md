# Clawd Bot design: OpenCode through ACP

Historical design dated August 15, 2026, reconciled with the current general OpenCode integration. The internal `opencodeGo` identifier remains for saved-state compatibility; the product name is OpenCode.

## Scope

Launch the maintained OpenCode CLI through ACP stdio. Preserve the shared engine contract for sessions, tools, streaming, permissions, model selection, cancellation, MCP configuration, and process cleanup. This design does not introduce a direct provider HTTP client or own OpenCode's subscriptions.

## Architecture

The engine-specific definition lives in `server/drivers/acp/opencode-go.ts`; shared JSON-RPC behavior lives in `server/drivers/acp/core.ts`. Model discovery runs the configured CLI and preserves provider-qualified identifiers. A last-successful catalog and static fallback contain catalog outages.

The original proposal used a public Go-only catalog and key-required availability. Those assumptions are superseded: existing OpenCode logins and usable-model probing can make the engine available. A discovered model is still not proof of inference access.

## Runtime and credentials

Initialize ACP, create or load the session, set the exact selected model using `session/set_config_option`, then prompt. Stream text and tool events through the normal harness and resolve approvals through its permission path.

A supplied OpenCode key is child-scoped and write-only to the UI. Authentication discovery reads existing OpenCode login state without rewriting `auth.json`. Injected local models may update provider/model entries in `opencode.json`; that configuration write and its credential handling need separate coverage.

## Error and acceptance contract

Distinguish unavailable CLI, invalid credentials, subscription or quota restrictions, upstream failure, and model discovery failure. Prefer structured error codes over mutable provider prose. An OpenCode failure must not disable unrelated engines.

Fake-CLI tests must cover ordering, exact IDs, streaming without duplicate final text, permissions, resume, model switching, malformed messages, cancellation, cleanup, and concurrent-session isolation. Live provider verification is opt-in and must not publish credentials or raw authenticated logs.

See [the maintenance checklist](../plans/2026-08-15-opencode-go-integration.md) and [current setup](../../opencode-go.md).

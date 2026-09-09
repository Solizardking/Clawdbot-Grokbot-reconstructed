# Clawd Bot plan: reject duplicate permission request IDs

Historical design from August 18, 2026. Reconcile it with the current [Claude broker](../../server/drivers/claude.ts) before implementation. This concerns duplicate IDs during an active turn; late requests after teardown are covered by [the separate lifecycle plan](2026-08-18-001-fix-claude-turn-teardown-zombie-cards-plan.md).

## Failure addressed

The broker's pending map is shared across connections. Registering a second request with an existing ID can overwrite the first entry, emit two cards, and leave a card unanswerable when either request finishes. Both normal producers generate fresh UUIDs; the guard protects against malformed clients and future producer mistakes rather than a documented legitimate replay flow.

## Broker contract

Check for an existing ID after parsing and the closed-broker check, before constructing timers, updating the pending map, or calling `onAsk`.

On collision, return an explicit answer to the second connection with the same ID, `behavior: "deny"`, and a fixed diagnostic. Keep the first pending entry and its timer untouched. Log a bounded diagnostic rather than request contents. Do not rename the second ID or silently drop the request.

A request ID can be reused after the original request has resolved and left the pending map. The guard is scoped to live requests, not an unbounded history of every ID ever seen.

## Regression matrix

- Duplicate ID on one connection: one actionable request, explicit denial for the duplicate, original still resolvable.
- Duplicate ID across two connections: denial goes to the second connection; the first remains answerable.
- Different IDs: both proceed independently.
- Resolved ID reused: the new request is accepted.
- Broker already closed: terminal shutdown behavior wins over duplicate handling.

Verify the full reply payload, event count, and original request's eventual answer. Tests must not settle for observing only a denial string.

## Scope and verification

The change belongs in `createPermissionBroker()` and its existing tests. Inspect UUID creation in `server/permission-proxy.ts` without changing that producer solely for this guard.

```sh
npx vitest run server/drivers/claude.test.ts
npm run typecheck
```

Run from the Clawd Bot root. Give concurrent test brokers unique socket/pipe names; see [Windows test isolation](2026-08-18-002-fix-windows-pipe-name-collision-in-collision-tests-plan.md). Keep this fix independently reviewable from process teardown changes.

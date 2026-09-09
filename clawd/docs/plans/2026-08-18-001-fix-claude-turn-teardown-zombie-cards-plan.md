# Clawd Bot plan: close Claude turns without orphaned approvals

Historical design from August 18, 2026, associated with upstream issue 211. This is a maintenance contract, not a claim that the original bug still exists or that a fresh implementation is needed. Inspect the current [Claude driver](../../server/drivers/claude.ts) and its tests before changing code.

## Failure addressed

A one-shot Claude child could emit its result but remain alive. Teardown removed the active turn and closed the broker listener without necessarily closing existing connections. A late permission request could then produce a card whose owning turn no longer existed, leaving the user unable to answer it.

## Required behavior

1. Every terminal path settles once, closes the broker, and terminates the owned child process tree using `killCliTree`.
2. A late ask on an already connected socket never creates `request.opened` or another pending entry.
3. Late callers receive an explicit terminal reply: deny permissions, and answer questions with a system message that the turn is ending. A silent drop can leave the proxy waiting indefinitely.
4. Already pending asks retain their terminal resolution behavior. Successful turns retain their completion payload and event order.

## Implementation boundaries

Use a broker-local `closed` flag set before resolving pending asks. Check closure before duplicate-ID handling and registration. Do not use the active-turn map as this flag: broker construction can precede active-turn registration.

Call `killCliTree(child)` during settlement after closing the broker. Reuse the shared POSIX process-group and Windows tree-kill behavior. The historical design did not add per-turn SIGKILL escalation or an orphan scan at startup.

A descendant that deliberately creates a separate process group can escape the ordinary tree contract. A grace timer alone does not solve that problem. Treat self-detaching grandchildren, startup recovery, and equivalent changes in other drivers as separately tested follow-ups.

## Acceptance checks

Extend the existing fake CLI with a result-then-hang scenario and record its PID in test-only temporary output. Wait for completion, then verify the process actually exits within a bounded interval; a completion event alone is insufficient.

Keep a broker connection open through interruption, wait for settlement, then send a late permission and question. Assert explicit replies and no new actionable cards. Preserve successful, early-exit, and pending-ask interruption cases.

```sh
npx vitest run server/drivers/claude.test.ts server/kill-tree.test.ts
npm run typecheck
```

Run commands from the Clawd Bot root. Report current outcomes rather than retaining the original test totals. Changing other drivers or introducing startup process cleanup needs its own scope and evidence.

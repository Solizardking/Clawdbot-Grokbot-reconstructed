# Clawd Bot harness roadmap: revised sequence

Historical revision of [the original harness plan](agent-harness-upgrades.md). This document records scope corrections and delivery order; inspect current code before treating an item as unimplemented.

## Corrections to the first plan

The composer already had text/file attachment handling, so attachment work was narrowed to images. `server/redact.ts` already provided a redactor, so the proposal needed a result-side call site and content rules. The event inspector moved earlier to make later lifecycle work observable. Per-bot working directories became an explicit early task because adapters already accepted a working directory.

Automatic retries and images were moved to the later round in the August 17 revision. Do not revive their earlier priority simply because they also appear in the original roadmap.

## Delivery sequence

| Round | Work |
| --- | --- |
| 1 | Model-switch context, event inspector, per-bot working directory, usage visibility, cross-task search. |
| 2 | Liveness reconciliation, portable context, durable delegation, stored-result redaction, explicit approval outcomes, store-owned events, server activity state, observe-only repeated-call detection. |
| 3 | Local models, native mid-turn steering, enforceable loop/deadline policy, bounded retries, image attachment completion. |

Liveness must precede durable queue draining and steering. Context portability must precede adapters that need harness-owned replay. Repeated-call detection initially reports a pattern and offers interruption; it must not pretend to terminate an individual tool that only the CLI controls.

Keep driver integration small, source data authoritative, and approval failure explicit. Cross-cutting changes should preserve the shared contracts rather than adding a parallel policy layer per engine.

## Model-switch context contract

The detailed first task centers on `server/turn-context.ts` and `server/turn-context.test.ts`. A saved resume cursor does not by itself prove the target engine has seen the current active transcript. Dispatch must distinguish a usable current session, a fresh engine, a rewind, and intervening work on another engine.

Use the store's active branch and per-task dispatch history to choose resume versus replay. Record which instance was dispatched at the owning store boundary. Preserve the latest user message exactly once and prevent dropped or duplicated history when switching engines, switching back, or changing branches.

The existing `buildTurnContext` and `engineIsFresh` implementation and tests take precedence over old draft signatures. Do not replace them with a historical code snippet without checking current callers and behavior.

## Acceptance for context changes

1. Reproduce the gap with fake engines and an isolated workspace.
2. Cover first dispatch, same-engine continuation, engine switch, switch-back after another engine's turn, and rewind.
3. Assert the actual prompt content and resume decision, not only helper return shapes.
4. Exercise the real server dispatch/store path and confirm active-branch ordering.
5. Run focused checks, then the normal suite if runtime code changed.

```sh
npx vitest run server/turn-context.test.ts server/branching.test.ts server/index.test.ts
npm run typecheck
npm test
```

## Acceptance for later work

Retries need transient/terminal classification, bounded jittered backoff, visible retry state, and interruption during backoff. Redaction needs tests that inspect persisted output, not only a standalone regex. Durable work needs restart/replay tests proving no duplicate dispatch. Image support needs upload, rendered history, reload, and unsupported-driver behavior. Native steering requires a protocol experiment before a queue implementation.

Keep current test totals and completion evidence with the change being reviewed. This archive does not establish a live feature release, a passing platform matrix, or authorization to execute a backlog.

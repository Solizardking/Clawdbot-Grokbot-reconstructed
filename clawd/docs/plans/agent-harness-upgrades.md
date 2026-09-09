# Clawd Bot harness roadmap: original design

Historical planning baseline, retained for design context. [The revised roadmap](agent-harness-upgrades-v2.md) changes sequencing and corrects several assumptions. Neither document is a current list of missing features or an instruction to implement every item.

Clawd Bot owns the conversation store and event flow while provider adapters own native engine sessions. Improvements must preserve that boundary and avoid making each new driver duplicate harness policy.

## Round 1: conversation continuity and visibility

| Item | Intended behavior and acceptance |
| --- | --- |
| 1. Model switching | Rebuild context from the active transcript when the target engine lacks a usable session. Switching away and back must not silently lose intervening messages. |
| 2. Attachments | Persist supported input and show it in the composer/transcript. Respect size limits and each driver's capabilities. The original text-only assumption was corrected in v2. |
| 3. Retry | Classify transient errors separately from authentication, invalid model, and quota failures; bound backoff, expose retry state, and cancel promptly. Prevent duplicate partial output. |
| 4. Search | Find messages across tasks and navigate to the exact match with surrounding context. |
| 5. Usage | Surface reported token/cost information without presenting unavailable provider estimates as measured cost. |

## Round 2: harness guarantees

| Item | Intended behavior and acceptance |
| --- | --- |
| 6. Liveness | Reconcile an in-flight turn with its owned process and recover stale state without killing unrelated work. |
| 7. Portable context | Include useful activity in replays, support compaction records, use model context limits, and rebuild for the target engine's budget. The visible transcript remains authoritative. |
| 8. Durable delegation | Persist queued peer work and reconcile process/turn state before draining it after restart. Avoid duplicate dispatch. |
| 9. Tool loops and deadlines | Detect repeated normalized calls. Enforce deadlines only at a boundary the harness actually controls. |
| 10. Redaction | Redact persisted tool results with the existing secret redactor and appropriate content/path rules before storage and fan-out. |
| 11. Approval outcomes | Represent allowed, rejected, cancelled, and unavailable outcomes explicitly. Link requests to the correct tool item and fail closed. |
| 12. Generation fencing | Reject events from obsolete provider generations before they mutate current state. |
| 13. Store-owned events | Couple writes and events so callers cannot update storage while forgetting UI notification. Avoid an unnecessary universal transaction rewrite. |
| 14. Activity state | Compute activity on the server and migrate existing busy readers incrementally. |
| 15. Event inspector | Inspect raw event flow for debugging without exposing provider credentials or making protocol dumps a normal user requirement. |

## Round 3: capabilities built on those guarantees

Local model adapters should reuse the common driver contract and portable-context path. Discover configured endpoints and models without promising a provider's current catalog or capacity.

Mid-turn steering needs a verified native protocol boundary. In particular, determine whether the CLI can accept further input after the existing stdin lifecycle before designing a queue. A transport that cannot steer must report that limitation.

## Dependencies and risks

Liveness precedes durable dispatch and steering. Portable context builds on the corrected model-switch path. Inspection makes event ordering and retries testable. Observe-only loop detection can precede enforcement; a CLI-owned tool cannot necessarily be terminated independently of its entire turn.

Storage migrations must preserve active branches, historical messages, and recoverable state. Generation changes must not invalidate a live request without a terminal outcome. Driver-specific features should remain optional capabilities rather than expanding every adapter's mandatory surface.

Deferred topics include external memory integration, remote-access expansion, and decomposition of the main server router. Revisit each against current code and an explicit product need before choosing a dependency.

## How to resume

Start with [the revised roadmap](agent-harness-upgrades-v2.md), `server/contracts.ts`, `server/store.ts`, `server/turn-context.ts`, and the relevant adapter. Reproduce the proposed gap, define its acceptance behavior, and run focused tests with isolated data. Use `npm run typecheck` and `npm test` for repository checks; old line numbers and test totals are not current evidence.

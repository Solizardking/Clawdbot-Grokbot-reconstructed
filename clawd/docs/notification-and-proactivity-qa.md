# Clawd Bot notification and proactivity QA

Clawd Bot starts work through a user action or configured trigger: an active task's Auto mode, a Routine, a Webhook, or permitted peer coordination. This contract does not introduce an unconfigured heartbeat that invents work.

## Expected notifications

The harness owns notification policy. A bot with notifications disabled remains quiet. Eligible notifications include an approval or question, a computer takeover request, a non-empty completion, and a failed routine.

Each notification must carry the bot ID and exact task thread ID. Clicking it selects both, including detached routine tasks. Desktop notifications are suppressed when the app window already has focus. iOS can handle live/replayed alerts while connected; a tunnel or VPN does not provide closed-app push delivery.

## Automated checks

| Contract | Coverage |
| --- | --- |
| Per-bot preference, empty results, bounded summaries | `server/notify.test.ts` |
| Browser click target | `src/lib/notify.test.ts` |
| Exact task navigation | `src/state/store.test.ts` |
| Routine failure callback and receipt | `server/routines.test.ts` |
| Single failure notification, no duplicate completion | `server/notification-wiring.test.ts` |
| iOS target decoding | `ios/Tests/CompanionCoreTests/DecodingTests.swift` |
| Phone API boundary | `companion/test/routes.test.ts` |

Run applicable suites from the Clawd Bot repository root with `npx vitest run <test-file>`. Native Swift checks run from `ios/` with `swift test`.

## Manual acceptance pass

Use two bots, with notifications enabled on one and disabled on the other:

1. Background the desktop, complete a task, and confirm a single result notification opens that exact task.
2. Trigger an approval and a question. Check their text and targets; no completion should appear while the request remains unresolved.
3. Run a routine successfully, then produce a controlled failure. Confirm one failure alert and a receipt linked to its detached task.
4. Repeat with notifications disabled. Chat and receipts should still update without a system alert.
5. On iOS, tap a live or replayed notification for an inactive task and verify the server-side task switch and navigation.
6. Exercise Auto, a Routine, and a Webhook separately. Identify the initiating action/configuration for each.
7. Test duplicate/replayed events, reconnect, denied OS notification permission, and opening the target after another task becomes active.

Record OS, app build, trigger, target IDs, and result without private message content. Unit tests do not prove OS permission prompts, suspended-app behavior, or a deployed APNs service. See [iOS companion](ios-companion.md).

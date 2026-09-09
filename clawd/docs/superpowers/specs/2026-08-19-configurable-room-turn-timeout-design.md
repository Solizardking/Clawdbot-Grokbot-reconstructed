# Clawd Bot design: configurable room turn timeout

Design dated August 19, 2026. This contract describes the persisted room-turn ceiling; it is separate from the inactivity watchdog. Inspect [the current timeout helper](../../../server/room-turn-timeout.ts), config schema, and General settings before treating it as new work.

## Configuration contract

```json
{
  "rooms": {
    "turnTimeoutMinutes": 5
  }
}
```

The setting accepts whole minutes from 1 through 1,440. Missing configuration defaults to five minutes. Stored config and API patches reject malformed structure, non-numeric values, fractions, and out-of-range values. The effective value is public non-secret config status.

Saving only the room setting must update the in-memory config and broadcast status without reloading providers or interrupting running turns. There are no per-room overrides or additional environment override in this design.

## Timer behavior

Capture the configured duration at dispatch. A later edit affects future turns only and never moves a running turn's deadline. On expiry, use the existing interruption, room ownership, and timer cleanup behavior.

Activity text includes the captured duration with correct singular/plural wording, such as “Atlas's room turn exceeded 1 minute and was stopped.” The independent `OMB_TURN_STALL_MS` watchdog may stop an inactive turn earlier; the room setting is an absolute duration ceiling, not an inactivity interval.

## Settings behavior

The General settings **Room turns** card exposes **Maximum turn length** with a minutes suffix. Save on blur; Enter blurs to save. Invalid values stay visible with an inline error and are not submitted. Failed saves preserve the user's entered value while the last confirmed setting remains authoritative.

Config events synchronize the field unless the user is actively editing it. Supporting text explains that the ceiling applies to each room member turn and differs from direct-chat stall handling.

## Data flow and validation

1. `GET /api/config` returns the effective room setting.
2. The client hydrates and folds config updates.
3. `PUT /api/config` validates and persists a rooms-only patch.
4. New room turns capture that value and enforce their own deadlines.

Cover defaults, valid persistence, malformed patches returning HTTP 400, client state folding, field validation/save errors, no provider reload for a rooms-only patch, captured deadlines, and singular/plural timeout messages.

```sh
npx vitest run server/room-turn-timeout.test.ts
npm run typecheck
```

Run from the Clawd Bot root and include config/UI regression suites when changing those surfaces. Passing the helper test alone does not prove the full settings-to-dispatch flow.

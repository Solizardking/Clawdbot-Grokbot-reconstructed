# Clawd Bot adaptation status — September 9, 2026

The requested documentation tree is indexed and checked against the standalone Clawd Bot workspace. Source validation passed. Full cross-platform and credentialed integration acceptance remains incomplete; see the specific limits below.

## Changes made

- Added a [documentation index](README.md) and navigation for every requested asset, screenshot, iOS, reconstruction, plan and specification directory.
- Repaired broken plan/source links and documented which historical OpenCode plans are superseded. Preserved original screenshots and reconstruction notices rather than presenting them as current Clawd evidence.
- Added `npm run docs:check` to check local Markdown targets and root npm script references.
- Adapted [Podman](../deploy/podman/README.md) to `npm ci`, the `source` workspace, `dist-ui`, and the Clawd health identity. Added the missing `.env.example` and `.dockerignore`; existing environment files and workspace data were not replaced.
- Removed unsupported public-browser pairing instructions from the current Podman guide. The inherited Docker examples are explicitly labeled historical because their upstream image and pairing CLI are not this standalone harness.
- Static/packaged first launch now serves setup while optional CLI discovery runs. The isolated packaged smoke checks Clawd identity, static HTML and all 11 helper paths.
- Computer-control tests now wait for observed fixture requests instead of assuming an HTTP request completes within 120 ms. Pet round-trip verification compares every image byte without a costly generic deep-equality traversal.
- Excluded local `work/` backup bundles from source publication.
- Fixed shared ACP permission option selection: a one-time decision cannot select a session-wide grant, regardless of provider option order. Missing one-time options cancel and return `unavailable`. Both regression cases failed before the fix; all 128 ACP tests passed afterward.
- Installed OpenCode 1.18.30 from its official npm package. Verified the real ACP v1 initialization handshake and Clawd's refreshed inventory (34 models, available). Cursor's refreshed inventory also reports available (5 models).
- Completed local voice setup using the already selected system provider and installed Samantha voice. Clawd synthesized a valid 58,794-byte WAV and reports `ready: true`; no microphone recording or hosted synthesis was used.

## Validation evidence

Commands ran from `clawd/` on macOS with Node 24.15.0 unless stated otherwise. This working tree changed through other local commits during validation; these results describe the tested files and commands, not a signed release or immutable deployment revision.

| Check | Result |
| --- | --- |
| Test data isolation | Passed before the application suites. |
| `npm run build` | Passed UI, server, companion, updater and typechecking. |
| Final `npm run typecheck` | Passed after the startup and fixture changes. |
| `npm run check:electron` | 62 Electron modules syntax-checked. |
| Final `npm test -- --maxWorkers=4` | 2,100 passed, 18 skipped; 206 files passed, one skipped; count floor passed at 2,118 registered tests after the ACP permission correction. |
| `npm run test:integrations` | 51 passed, zero failures. |
| Focused pet/control/steering rerun | 26 passed. |
| Focused Antigravity/team-manifest rerun | 32 passed. |
| Packaged server after startup fix | Passed in a temporary workspace with no repository dependencies; Clawd health, static HTML and 11 proxy paths verified. |
| ACP permission follow-up | 128 ACP tests passed after adding two regressions; typecheck, server rebuild and isolated packaged startup passed. Full suite also passed: 2,100 tests passed, 18 skipped. |
| Composio broker | Type check passed; 7 tests passed. |
| Control-plane Worker | Type check passed; 42 local emulator tests passed. No deployment performed. |
| `npm run docs:check` | All local Markdown references and checked root scripts passed. |
| Podman Compose and setup | `docker compose --env-file deploy/podman/.env.example -f deploy/podman/compose.yaml config --quiet` and `sh -n deploy/podman/setup.sh` passed. Container build/runtime unverified. |
| Source publication | Passed after excluding backup bundles; checks current exportable files, not Git history. |
| Installed app health | HTTP 200, `app: clawdbot`, `static: true`. |
| Connected-app inventory | HTTP 200, `configured: true`; one service entry. No provider action or account grant tested. |
| Avatar persistence smoke | Passed upload/replacement/restart and rejection paths in an isolated built server; evidence `/tmp/clawd-avatar-acceptance.json`. |
| Local voice | 75 voices listed; Samantha WAV synthesis passed and default readiness is true. |
| OpenCode | CLI, ACP v1 and discovery passed. Live `opencode/big-pickle` turns through Clawd’s actual adapter returned the exact marker, preserved it across session resume and cancelled a resumed turn cleanly. The earlier `opencode/nemotron-3.5-lightning-free` request timed out at 60 seconds; that model remains unverified. A generated-fixture request reached Clawd and was denied; a later allow check was blocked by inconsistent model discovery/permission behavior and is not claimed as passed. |
| Swift core | Blocked: compiler 6.3.3 and SDK built with 6.3.2 mismatch. No full Xcode app found in `/Applications`; active developer directory is CommandLineTools. |
| Visual QA | [Report](../design-qa.md): blocked. Native captures opened; reference state/density differ, browser capture unavailable, installed VPS help link stale. |

The first sandboxed suites failed to open local sockets (`EPERM`); they were rerun with local listener access. The first unrestricted full run and an intermediate four-worker run exposed startup/fixture timing and pet comparison failures. They are superseded by the final passing run above, not silently counted as successes. Early packaged checks timed out before the static first-launch fix.

Follow-up source logs: `/tmp/clawd-acp-approval-before.log` (two expected regression failures), `/tmp/clawd-acp-approval-after.log`, `/tmp/clawd-acp-full-final.log`, `/tmp/clawd-acp-typecheck.log`, `/tmp/clawd-acp-build.log` and `/tmp/clawd-acp-packaged-final.log`.

Additional live evidence: `/tmp/clawd-avatar-acceptance.json`, `/tmp/clawd-opencode-adapter-acceptance.json` and `/tmp/clawd-opencode-lifecycle.json`. These checks used generated, temporary workspaces and no user-provider credentials.

Raw local command logs are under `/tmp/clawd-docs-*.log`; the voice artifact is `/tmp/clawd-docs-voice.wav`. These are local scratch evidence, not published diagnostics. The historical installation incident in `install-status-2026-09-07.md`, when present locally, remains unchanged and no data recovery is claimed.

## Guide-by-guide acceptance limits

| Requested guide or directory | Adaptation and remaining live acceptance |
| --- | --- |
| `docs/`, `assets/`, `screenshots/` | Indexed, references validated, original evidence preserved; normalized visual comparison remains blocked. |
| `ios/`, `ios-companion.md`, `ios-privacy.md` | Mapped to native sources and companion allowlist. Requires matching Apple toolchain, simulator/device build, paired iPhone and transport tests. |
| `plans/`, `superpowers/`, its `plans/` and `specs/` | Current implementation/test map supplied. Archived deferred proposals are not promoted to implemented features. |
| `reconstruction/` | Historical package-manager and parent-repository boundaries explained; notices retained. |
| `avatar-storage.md` | Contracts and a live built-server persistence smoke passed in a temporary workspace: raw upload, profile assignment, replacement, old/new image retrieval, process restart and restored profile. Exact bytes and file mode 0600 verified; SVG/empty/missing references rejected. Visual thumbnail rendering remains unverified. |
| `byo-vps.md` | Lifecycle/routing contracts passed. No VPS SSH alias supplied, so no remote container provisioned. |
| `composio.md` | Updated for the installed managed-broker and expandable self-host setup UI. Inventory works; a specific provider operation remains unverified. |
| `computer-use-integration.md` | CUA, routing, control and proxy contracts passed. Native permission prompts and approved input on each real OS remain separate checks. |
| `cursor.md`, `opencode-go.md` | ACP contracts and live catalogs passed. OpenCode exact output, model selection, resume and cancellation passed using one advertised free model. Cursor live conversation and approval/cancellation still need credentialed acceptance. |
| `github-readiness.md`, `releasing.md`, `validation.md` | Current scripts and source boundaries verified; no signed release, history rewrite or publication claimed. |
| `install-status-2026-09-07.md` | Local historical record retained; not a current health report or required public-export file. |
| `linux-desktop.md` | Build/runtime boundaries documented; real Ubuntu Xorg/Wayland and package installation not tested on this Mac. |
| `notification-and-proactivity-qa.md` | Notification/routine/navigation contracts passed; OS notification and real phone background behavior remain unverified. |
| `voice-mode.md` | Local read-aloud synthesis now works. Microphone permission, recognition, calls, audio playback quality and per-member channel voices still need native acceptance. |

## Remaining setup

1. Supply the intended VPS SSH alias and a Linux x86_64 or Windows WSL2 test host. The available local Podman VM is stopped and uses Apple virtualization; this does not satisfy the recipe's supported-host target.
2. Use a matching Apple compiler/SDK and an available iPhone to run native companion and permission checks.
3. Complete authorized live provider turns and tool approval/resume/cancellation checks for Cursor and the chosen connected app. OpenCode lifecycle now has live evidence for `opencode/big-pickle`; other models are not implied to work.
4. Package and install the validated current source, then verify the corrected VPS help link and perform normalized visual QA. The running app was inspected but not replaced during this documentation task.

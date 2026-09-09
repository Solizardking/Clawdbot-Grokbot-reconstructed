# Security notes

This is a small-club reconstruction, not a supported production distribution.
Do not reuse real credentials or sensitive accounts while experimenting with it.

Reconstructed packages default the official updater, Sentry, and upstream
telemetry off at the Electron-main packaging boundary. The bootstrap download
and hydrated `app.asar` are checksum-pinned.

`npm audit` still reports compatibility-bound advisories in the pinned Electron
42.1 runtime, Undici 5 / Connect 1 stack, AI SDK 4, and OpenTelemetry stack.
Patch-level fixes are applied where they do not change reconstructed runtime
contracts. The remaining major upgrades are intentionally tracked as follow-up
work rather than silently changing application behavior during publication
cleanup.

Please report issues privately to the repository owner rather than opening a
public disclosure against this experimental codebase.
## Credential checks and publishing

Keep real configuration in ignored local environment files, with permissions
`0600`. Only placeholder `.env.example`, `.env.template`, and `.env.sample`
files belong in source control. Git ignore rules do not remove existing files
from the index or from earlier commits.

Run `npm run security:check` before sharing a checkout or building a release.
It checks Git's staged blobs, working copies, and unignored new files against
local credential values and common token/private-key formats. Reports contain
paths and variable names, never credential values. It is also part of `check`,
CI, deployment, and publication checks. Detection is not proof that every
possible secret format is absent; inspect the final distribution too.

Run `npm run security:history` before pushing. The tracked `.githooks/pre-push`
runs the history and current-file checks. This checkout's installed hook calls
that guard before the existing Git LFS hook. Other clones need to install the
guard alongside their own existing hooks; do not overwrite unrelated hooks.
The history check rejects private configuration filenames in reachable commits;
it is not a full content scan of every historical blob.

The September 9, 2026 audit found committed credentials in
`deploy/openrouter.env` and `clawd/cloudflare/control-plane/.dev.vars`.
Both were removed from the index while their local files were preserved.
Removing them does **not** invalidate credentials or clean earlier commits.
Rotate/revoke affected credentials and clean the affected history before
publication. The local pre-push guard blocks that history in the meantime.

# Clawd Bot avatar storage

Clawd Bot saves uploaded and generated avatars in the same attachment store as message images. Changing a bot's avatar updates its profile reference; it does not delete the previous image.

## Storage and limits

[The attachment store](../server/attachments.ts) writes UUID-named files beneath `<DATA_DIR>/attachments`. New directories use mode `0700` and new files use `0600`. The accepted MIME types are PNG, JPEG, GIF, and WebP; empty uploads and images larger than 10 MiB are rejected. MIME checks use the declared content type, not image-content sniffing. SVG uploads are not accepted.

The standalone server defaults to `~/.clawdbot`. Packaged Electron uses its application-data `workspace` directory. `CLAWD_DATA_DIR`, followed by the compatibility override `OMB_DATA_DIR`, can select another location. Back up the active workspace, including attachments, when moving an installation.

Serving accepts only supported bare filenames within the attachment directory. Profile and transcript references can point to the same file, so an avatar must remain available to older messages after a profile changes.

## Cleanup contract

There is no avatar-only provenance registry yet. Do not delete a file just because no current bot uses it: an active or archived transcript may still reference it.

A future cleanup job must record avatar ownership at creation, retain a grace period, and check all of the following before deleting each candidate:

1. The candidate belongs to the avatar-owned registry, rather than the legacy shared pool.
2. No bot profile references its `avatarUrl`.
3. No active or archived task or room message references its stored path.

Process only a bounded number of candidates per run. Until those checks exist, retaining replaced avatars is the intended behavior.

## Verification

Run `npx vitest run server/attachments.test.ts` from the Clawd Bot repository root. For a manual check, upload an avatar, reuse its image in a message, replace the avatar, and confirm the old message still renders after reload.

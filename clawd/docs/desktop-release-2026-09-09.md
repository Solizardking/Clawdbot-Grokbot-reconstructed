# Clawd Bot 0.1.37 desktop release

Current product source: `clawd/`. Desktop output: `clawd/release/`.
These are release candidates. Public worldwide launch is not approved by the checks below.

## Packages

| System | Files in `clawd/release/` |
| --- | --- |
| Windows x64 | `ClawdBot-0.1.37-setup.exe`, `ClawdBot-0.1.37-win-x64.zip` |
| Linux x64 | `ClawdBot-0.1.37-linux-x86_64.AppImage`, `ClawdBot-0.1.37-linux-amd64.deb` |
| Apple silicon | `ClawdBot-0.1.37-arm64.dmg`, `ClawdBot-0.1.37-mac-arm64.zip` |
| Intel Mac | `ClawdBot-0.1.37-x64.dmg`, `ClawdBot-0.1.37-mac-x64.zip` |

Run `node scripts/verify-desktop-release.mjs --snapshot .build/desktop-release` from `clawd/` after packaging
finishes. It requires all eight artifacts, checks the four unpacked app versions
and entry points against the current source/build, rejects obsolete artifact
versions, and writes `release/SHA256SUMS` and `release/release-manifest.json`.
It also opens the ZIP downloads and checks their actual bundled server bytes.
This release uses the fixed runtime snapshot taken at 2026-09-09 14:25:29 UTC;
later worktree builds cannot silently change it. The manifest records whether
the current worktree server still matches that snapshot.

## Cleanup and repeatable builds

- Removed 22 obsolete locations: root `.build`, root `dist`, the old
  `clawd/work/Clawd Bot.backup.app`, and explicitly identified cached app copies.
- Cached app copies occupied approximately 4.5 GB. Private signing material,
  credentials, active configuration, development tools, authored source, hooks,
  CI, mobile source, documentation and research reference archives were retained.
- Root `node scripts/clean-obsolete-builds.mjs` previews this allowlisted cleanup;
  `--apply` performs it after checking that no tracked files or symlinks are targeted.
- Replaced the old npm tarball and dated npm export. Future exports use
  `clawd/publication/npm-current`.
- `npm run package:win` and `npm run package:linux` now stage the correct native
  dependencies, validate isolated server startup, and build without publishing.
  After a fresh `npm run build`, `-- --skip-build` reuses that build.
- Windows/Linux native CI is defined in the root
  `.github/workflows/desktop-packages.yml`. It is not yet on the remote default
  branch and was not run. The local branch contains other unpublished work;
  it was not pushed as part of this task.

The cross-platform packaging approach follows the
[electron-builder documentation](https://www.electron.build/v26/docs/features/multi-platform-build/).
Host-incompatible Linux binaries are checked against pinned checksums while
staging. Native Linux CI retains executable version and MCP-manifest checks.

## Verified

- Production UI, server, companion, updater and TypeScript build passed.
- Unit suite: 2,098 passed, 18 skipped. Integration suite: 51 passed.
- A permission-handling fix arrived during the first packaging run. The final
  snapshot includes it; all 128 focused ACP tests passed. The first archives were
  superseded rather than being labeled current after that source change.
- Repository secret scan: 4,255 tracked entries, zero findings at scan time.
- Windows/Linux packaged resources: 1,567 scanned files, no credential or
  private-path findings. No `node_modules` are shipped inside their ASARs.
- Windows package server starts outside the repository; all 11 proxy paths resolve.
- Linux x64 container executed the packaged CUA driver (0.19.3) and
  cloudflared (2026.8.2). Standard `libxi6` and `libxkbcommon0` were installed
  inside the disposable container. The packaged UI/server passed isolated startup
  with external network disabled. This is not a full native Linux desktop UI test.
- Apple silicon package passed strict deep code-signature verification, isolated
  server startup, first-launch UI rendering, and entry into the main workspace
  using temporary profiles. The live token feed populated.
- Current npm archive: 2,482 files; extracted server starts with no repository
  dependencies and all 11 proxy paths resolve. See `release/npm/RELEASE-CHECKS.md`.
- Website source now offers Mac, Windows and Linux targets; TypeScript passed.
  These website changes were not deployed during this task.
- Live website health, provider-gateway health, and current market feed health
  returned HTTP 200. `/api/releases` returned an empty release list.

## Remaining launch gates

1. Windows installer and application have no Authenticode certificate table.
   Configure signing, rebuild, and test installation on Windows.
2. macOS packaging explicitly disables notarization. The Apple silicon DMG has
   no stapled notarization ticket. Submit the final signed artifacts to Apple and
   staple/validate accepted tickets before opening public downloads.
3. Complete native Windows and Linux desktop/installer acceptance, and Intel Mac
   launch acceptance. Cross-packaging and server tests do not replace these checks.
4. Publish verified artifacts and register them in the existing release catalog;
   deploy the website platform choices. The live catalog currently serves no files.
5. Auto-update publication remains unconfigured (`publish: null`). Configure the
   intended release destination and validate an actual upgrade before relying on it.
6. Worldwide load, authenticated production inference, and full provider/tool
   behavior were not proven by this packaging task. Health responses alone do not
   establish capacity or end-to-end service readiness. The separate legacy
   `services/desktop-runtime/fly.toml` hostname did not resolve; no live deployment
   was removed based on that observation.

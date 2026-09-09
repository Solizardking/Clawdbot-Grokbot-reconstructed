# Clawd Bot on Ubuntu desktop

The Linux packaging target is Ubuntu 24.04 x86_64. The Electron package includes the harness and renderer; installed users still need whichever external agent CLIs and provider accounts they choose. Building and native desktop validation are separate steps.

## Build from source

Use the Node version in `.node-version` (currently 24.15.0) and the npm lockfile. From the Clawd Bot repository root on the Linux build host:

```sh
npm ci
npm run package:linux
```

The script builds the app, stages cloudflared and Android tools, prepares the pinned Linux CUA resources, and invokes electron-builder without publication. Artifact names follow [electron-builder.yml](../electron-builder.yml): `ClawdBot-<version>-<arch>.<ext>` for the AppImage and Debian targets under `release/`. Inspect the actual output filenames; this repository does not provide the old `package:linux:dir` or `package:linux:offline` npm shortcuts.

For development, keep these running in separate terminals. Use `npm run dev:desktop` on the desktop host when testing native features:

```sh
npm run dev:server
npm run dev
```

## Install a built package

Replace `PACKAGE.deb` or `PACKAGE.AppImage` with the actual downloaded or built filename:

```sh
sudo apt install ./PACKAGE.deb
```

Or make the AppImage executable and launch it:

```sh
chmod +x ./PACKAGE.AppImage
./PACKAGE.AppImage
```

Confirm that the artifact is for your architecture. Use the distribution's published checksums when available. A source build does not prove that any remote release download is current or signed.

## Enable local control

Clawd Bot separates preview from input control:

| Session | Screen preview | Local input |
| --- | --- | --- |
| GNOME Xorg | Explicit preview of the local display | Requires the global opt-in and assigning a bot to **This computer**. |
| GNOME Wayland | User-selected portal capture | Disabled by the app's input-safety gate. |

Starting preview does not give a bot control. On Wayland, choose a screen through the portal; stopping or cancelling must release the capture without an automatic second prompt. To use supported local input, sign into an Xorg session and enable it explicitly. Cloud computers and Local VM remain separate targets. Linux Auto must not implicitly select the host desktop.

The packaged CUA driver is pinned and validated, lives outside ASAR, and is not replaced by ambient PATH or `CUA_DRIVER_PATH`. Keep binary hashes and archive rules in [the staging script](../scripts/prepare-cua-linux.mjs) and [third-party records](../third_party/cua-driver/), rather than copying version-specific digests into setup instructions.

## Workspace and CLI discovery

The source server defaults to `~/.clawdbot`. Packaged Electron uses its application-data `workspace` directory. `CLAWD_DATA_DIR` and the compatibility override `OMB_DATA_DIR` can change the location; inspect the running installation before backup or migration.

GUI launches may have a different PATH from your terminal. Clawd Bot adds common CLI locations and probes the login shell. If an engine is missing, run it and sign in from a terminal, restart the app, and inspect the configured executable. `OMB_EXTRA_PATH` can add a custom directory during troubleshooting.

## Validation and troubleshooting

```sh
npm run typecheck
npm run check:electron
node scripts/verify-linux-package.mjs
node scripts/run-linux-package-smoke.mjs
```

Package checks require completed artifacts and a suitable Linux environment. For input changes, also run the relevant CUA tests and a real GNOME session pass. Verify launch, server readiness, approved Xorg input, Wayland refusal, preview chooser/cancel/retry, and quit cleanup.

If preview fails, check the session type and, on Wayland, the desktop portal/backend. If local control fails, use the reason shown in its settings card; do not bypass the gate by substituting an unverified driver. Linux dictation and ARM64 desktop support are not established by this x86_64 packaging guide.

For a remote Linux desktop, see [self-hosted VPS setup](byo-vps.md).

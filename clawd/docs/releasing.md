# Build and release Clawd Bot

This checkout has a validation workflow at [`.github/workflows/check.yml`](../.github/workflows/check.yml). It does not contain the previously documented `release.yml` workflow. Local packaging uses `--publish never`, and electron-builder has `publish: null`; packaging does not publish a release.

## Prepare a candidate

Use the Node version in `.node-version` and run from the Clawd Bot repository root:

```sh
npm ci
npm run publication:check
npm run build
npm test
npm run test:integrations
npm run check:electron
npm run test:packaged
```

Update the version in `package.json` and its npm lockfile together when making a release. Record the commit and validation outcomes. Use an isolated export when proving standalone installation; see [source readiness](github-readiness.md) and [validation](validation.md).

## Build desktop artifacts

On the appropriate build host:

```sh
npm run package:mac
```

Or, on the Linux build host:

```sh
npm run package:linux
```

Both stage native resources before electron-builder runs. The Windows targets exist in `electron-builder.yml`, but there is no `package:windows` npm script in this manifest. A Windows release needs an explicitly maintained native-resource/build lane and Windows validation before distribution.

The current product name is **Clawd Bot**, application ID is `com.clawdbot.app`, and artifact prefix is `ClawdBot-`. Read exact targets and filenames from [the builder configuration](../electron-builder.yml); do not reuse the former upstream release repository or certificate identity by assumption.

## Signing and installed behavior

A local ad-hoc signature is not Developer ID signing or notarization. A distributable macOS candidate needs the publisher's own valid signing/notarization configuration and verification of the final packaged bytes. Do not claim signing, notarization, or a trusted publisher based on a successful build.

Install the candidate as a complete bundle and verify launch, matching server health, a real configured agent turn, required native helpers, and quit/relaunch. Test on each supported architecture and OS. The packaged-server smoke proves server isolation and helper resolution, not the entire desktop experience.

## Publish a verified candidate

Prepare release notes with version, supported platforms, actual limitations, and checksums computed after final signing/stapling or repackaging. Confirm the destination repository and any update-feed configuration belong to this distribution.

Upload the reviewed artifacts and notes through the chosen release process. After publication, download the public artifacts again and compare their checksums. Verify installation and any update feed against those public bytes. Record the published URL and outcome; an upload alone is not a successful release.

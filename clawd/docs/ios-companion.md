# Clawd Bot iOS companion

<p align="center">
  <img src="screenshots/agent-profile-ios.png" alt="iOS companion Agent profile with Scout mascot, shape, upload, and generate-on-computer" width="360">
</p>

The native iOS companion connects to a Clawd Bot computer you pair with. Agent processes, provider credentials, and transcript storage stay on that computer. The phone uses a per-device credential stored in Keychain; it does not need a separate account for local or Tailscale pairing.

Current phone and desktop captures are in [screenshots](screenshots/README.md). Avatar upload, mascot shape, and generate-on-computer match the Agent profile screen above; provider keys cannot be pasted from the phone.

## Pair your phone

1. On the desktop, open **Settings → Phone**, enable phone access, and choose phone setup.
2. Scan the QR code on the iPhone and confirm the computer name and transport.
3. If the QR route is unavailable, use **Other ways to connect** for nearby discovery, a manual address, or a pairing code.
4. Revoke a lost or unused phone from desktop Phone settings.

The computer must remain awake with Clawd Bot running. The optional keep-awake setting prevents system sleep while phone access is enabled; it does not require the display to remain on.

## Connection routes

| Route | Setup and boundary |
| --- | --- |
| Trusted local network | Direct LAN access; nearby discovery uses Bonjour. Choose only on a trusted network. |
| Tailscale | Both devices need a working tailnet connection. Choose its dedicated pairing route explicitly. |
| Hosted HTTPS | Desktop owner signs in and provisions the optional hosted connection. The HTTPS address must be ready before use. |

The hosted route uses an outbound Cloudflare connector to the user's computer. Configuring a URL is not proof that its control plane, email delivery, or tunnel works. A sleeping host remains unreachable through every route. Protected connections do not silently downgrade to direct LAN; choosing LAN is an explicit user action.

## Current companion API surface

The authoritative boundary is [the sidecar route allowlist](../companion/src/routes.ts). It permits authenticated conversations, task management, transcript pagination/search/export, reactions, message editing and branch selection, basic bot and room creation, and pending-request responses.

The current allowlist also includes a restricted bot-profile update, avatar upload/generation, voice listing/synthesis, routine management and execution, and connected-app inventory/authorization. Connected-account removal remains desktop-only. An allowed API route does not by itself establish complete UI parity on every phone build.

General provider configuration, device administration, webhooks, team import/export, local computer lifecycle, and unlisted internal routes remain inaccessible. Interactive cloud-desktop joining needs an additional capability granted to that paired phone. The VPS loopback SSH viewer remains desktop-only.

Native composer dictation exists in `ios/App/SpeechDictation.swift`. It is separate from the macOS desktop call UI described in [voice mode](voice-mode.md). Do not label all iOS voice functionality absent or claim desktop call parity from the presence of synthesis routes.

## Architecture and storage

```text
Phone → LAN/Tailscale sidecar :8810
      → hosted HTTPS → guardian gateway 127.0.0.1:8812
                        → exact per-launch sidecar socket/pipe
Sidecar → authenticated route filtering and response/SSE scrubbing
        → loopback harness 127.0.0.1:8799 → local agents and SQLite
Desktop → companion control 127.0.0.1:8811
```

These are default ports; deployment configuration may override them. Electron owns the sidecar and hosted guardian lifecycle. The guardian must stop forwarding and terminate its connector when the paired sidecar generation ends, preventing a later process on a reused port from inheriting the public route.

The sidecar's device registry defaults to `~/.clawdbot-companion/devices.json`, with `OMB_COMPANION_DIR` as its override. It stores device-token hashes, separately from the harness workspace. The phone stores its pairing trust in Keychain. Transcripts remain behind the harness API; the phone does not own the SQLite database.

Authenticated endpoint snapshots at `GET /api/companion/endpoints` let paired devices learn protected route changes. The sidecar owns this route and returns bounded connection metadata, not provider credentials.

## Streaming and notifications

The phone resumes SSE from a `<streamId>:<seq>` cursor. A `hello` frame indicates whether the gap can be replayed; otherwise the client rehydrates current transcript pages. Older messages are loaded on demand. Screen streaming is opt-in while a computer view is visible.

Live and replayed notifications target the exact bot/task. iOS background execution lasts only a short grace period. A connected tunnel or VPN cannot wake a suspended or terminated app; closed-app push delivery requires a separately deployed push path. See [notification QA](notification-and-proactivity-qa.md).

## Build and validate

From the Clawd Bot repository root:

```sh
npm run typecheck
npm run build:companion
npm run check:electron
npx vitest run companion/test/routes.test.ts
```

On a Mac with the iOS build tools:

```sh
cd ios
swift test
xcodegen generate
xcodebuild -project ClawdCompanion.xcodeproj -scheme ClawdCompanion \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

The checked-in workflow currently runs application and Worker checks; it does not prove an iOS simulator or signed device build. Test QR pairing, revocation, reconnect/replay, native dictation permissions, approvals, backgrounding, and chosen transports on a real iPhone. Review [privacy](ios-privacy.md) before distribution.

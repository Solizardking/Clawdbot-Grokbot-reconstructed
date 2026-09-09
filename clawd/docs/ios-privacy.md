# Clawd Bot iOS companion: data handling

This document describes the native iOS companion and the optional hosted connection in this source tree. It is a technical data-flow description. A distributed build and its service operator must verify their actual behavior and publish the applicable privacy disclosures before release.

## Phone and computer

The phone stores the selected computer address in preferences and its pairing credential in Keychain. The paired computer owns agent processes, provider credentials, transcripts, approvals, and stored images. Phone features can request this content through authenticated, allowlisted routes.

Local connections go directly over the chosen trusted network. Tailscale is an optional third-party transport. The phone can also request speech synthesis from the computer; hosted synthesis sends the submitted text to the configured provider. Native dictation uses Apple's Speech framework and requests on-device recognition where supported. Do not infer a universal offline guarantee from the use of a native recognizer.

Avatar generation, connected-app authorization, and bot execution may use the providers configured by the computer owner. Those operations have provider-specific data flows beyond the phone transport itself.

## Optional hosted access

Desktop sign-in can enable an HTTPS route through Cloudflare to the user's computer. The control plane handles account email, account and installation identifiers, computer metadata, security timestamps, tunnel/DNS resource identifiers, and operational status. Its data model is separate from the local transcript database.

Conversation requests, approvals, transcript responses, and screen frames pass through the hosted proxy when that route is used. The control-plane design does not persist them as a cloud transcript store. Cloudflare processes traffic and connection metadata as part of providing transport; a deployed service's logging and retention configuration must be checked separately.

Connector credentials belong in the desktop encrypted credential store. Pairing credentials are managed by the phone and sidecar, rather than the hosted account database.

## Analytics scope

The native iOS project has no third-party advertising or analytics SDK in its declared project dependencies. That statement does not describe the desktop/web renderer: it includes PostHog and an analytics preference in [its analytics module](../src/lib/analytics.ts). Review the actual submitted target and enabled services when completing store disclosures.

## Control and deletion

Unpairing on the phone removes its saved connection. Revoking the device on the computer invalidates its access. Transcript and attachment deletion is controlled by the installation that owns those files; disconnecting the phone does not delete them.

Disabling hosted access must revoke the hosted installation connection and clean up its tunnel/DNS resources according to the deployed service. Hosted account deletion, log retention, and any required retention exceptions are operator responsibilities; this source document does not establish a production retention period or support response guarantee.

Use the support contact supplied with your distribution for private data requests. For source questions, use the [repository issue tracker](https://github.com/Solizardking/clawd-bots/issues) without posting pairing codes, tokens, keys, or private transcripts.

## Release review

Compare the submitted binary, [privacy manifest](../ios/App/PrivacyInfo.xcprivacy), companion allowlist, configured providers, and production service before publishing privacy answers. Revisit this document when adding analytics, crash reporting, push delivery, or server-side content retention.

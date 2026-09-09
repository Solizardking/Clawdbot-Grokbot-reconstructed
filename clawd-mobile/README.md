# Clawd for Solana Mobile

Native Android beta for wallet sign-in, hosted AI conversations, and exact-mint SOL/CLAWD market research. Built from the official expo-kit-minimal Solana Mobile template with Expo 57, React Native, Solana Kit, and Mobile Wallet Adapter.

## Run and build

Use Node 24, Java 17, and the Android SDK. From this directory:

```sh
npm ci
npm run ready
npm run android
```

This app requires a native Android build; Expo Go cannot load its native wallet and crypto modules. The web preview shows the interface but cannot use Android secure storage or Mobile Wallet Adapter.

For the local signed arm64 release:

```sh
npm run release:android
npm run verify:release
```

The build script reads the operator signing configuration from the repository's ignored `.cache/clawd-mobile-signing/signing.json`. It expects `keystore`, `alias`, `storePassword`, and `keyPassword` fields. Set `JAVA_HOME` and `ANDROID_HOME` to override the local defaults. The Gradle plugin refuses release builds without signing credentials. Back up the private keystore and its passwords securely: updates must use the same signing identity.

Output: `artifacts/clawd-mobile-0.1.0-arm64.apk`. Generated Android projects, APKs, and signing credentials are ignored by Git. Package identity: `com.clawdbot.mobile`, version code 1. Increase the version code for every subsequent public release.

## Accounts and services

- **Wallet identity:** Use installed wallet opens an MWA wallet, requests Sign In With Solana, and sends the signed challenge to Clawd's native authentication API. The server binds each challenge to a random client proof, verifies the exact signed message, prevents replay, and issues a revocable seven-day session.
- **Hosted access:** This beta accepts an operator-issued Clawd gateway access code separately from wallet identity. Provider keys remain on Fly. Android secure storage holds the device's access code, wallet authorization, and session token. Signing into a wallet does not grant paid services automatically.
- **Research:** The Desk loads real market snapshots and hourly price charts for the exact selected mint, with source links and retrieval times. Old data is marked last known. Chat can include a user-selected market snapshot and uses only models granted to the account.
- **Privacy:** Conversations remain in memory on this device but are sent to the selected hosted provider when submitted. This build does not sign trades, move funds, or request wallet private keys. The Account screen links to the website's privacy policy.

Endpoints are fixed in `constants/endpoints.ts`; never add provider API keys to Expo public configuration. Website native routes live in `../clawd/site/app/api/auth/native`. Android Digital Asset Links are served from the website's `/.well-known/assetlinks.json`, using only the public release certificate fingerprint.

## Verification and release boundary

The September 9 beta passed 42 mobile tests, TypeScript and lint checks, APK signature verification, native ELF and ZIP 16 KB alignment checks, and its permission audit. Live website checks confirmed Digital Asset Links, `/privacy`, and native wallet challenge/origin rejection. No emulator or physical-wallet flow was completed. `npm run ready` repeats the automated half of this list.

Automated checks cover access-file destination binding, native/browser authentication separation, replay and bad-signature rejection, malformed market responses, wallet cancellation, and missing-access UI. Live authentication checks use an ephemeral test wallet and revoke its session afterward. These checks do not replace an installed-wallet test on an Android device.

Before store submission, verify the signed APK on a Solana Mobile device: wallet approval and cancellation, session restoration and logout, granted chat, market refresh, offline recovery, and accessibility. Public release also requires final legal/support information, store artwork and screenshots, a Publisher Portal app with its App NFT, a portal API key, and the publishing signer. No store submission or on-chain publishing transaction has been performed.

The inherited `e2e/fakewallet.sh` tests the original template screens and is not a release check for Clawd. Use the manual device checklist above until that harness is updated for this interface.

Dependency overrides update UUID and URI decoding. `scripts/patch-query-string.mjs` preserves Expo Router's CommonJS query-string API while using the patched URI decoder; regression tests cover its interoperability and malformed input handling.

Official references: [React Native setup](https://docs.solanamobile.com/get-started/react-native/setup), [Solana Mobile CLI](https://docs.solanamobile.com/cli/create), and [Publisher Portal](https://publish.solanamobile.com).

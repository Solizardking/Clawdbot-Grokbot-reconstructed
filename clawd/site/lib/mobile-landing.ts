export const MOBILE_PUBLIC_PATHS = ['https://x402.life/mobile', 'https://clawdcompute.us/mobile'] as const;

export const mobileLanding = {
  brand: 'CLAWD',
  product: 'Clawd for Solana Mobile',
  eyebrow: 'NATIVE ANDROID BETA',
  heading: 'Solana Mobile. Wallet in your pocket.',
  summary:
    'A native Android beta for Sign In With Solana, hosted AI conversations, and exact-mint SOL/CLAWD market research. Built with Expo 57, React Native, Solana Kit, and Mobile Wallet Adapter.',
  packageName: 'com.clawdbot.mobile',
  version: '0.1.0',
  versionCode: 1,
  architecture: 'arm64',
  apkName: 'clawd-mobile-0.1.0-arm64.apk',
  install:
    'Install the signed arm64 APK on a Solana Mobile or Android device with an MWA wallet. Package identity is com.clawdbot.mobile, version code 1.',
  expoGo:
    'This app requires a native Android build. Expo Go cannot load its native wallet and crypto modules, Android secure storage, or Mobile Wallet Adapter. The web preview shows the interface only.',
  privacyHref: '/privacy',
  privacyLabel: 'Privacy policy',
  desktopHref: '/',
  noTrades: 'This build does not sign trades, move funds, or request wallet private keys.',
  features: [
    {
      title: 'Wallet identity',
      text: 'Use installed wallet opens an MWA wallet, requests Sign In With Solana, and sends the signed challenge to Clawd’s native authentication API. Sessions last seven days and can be revoked.',
    },
    {
      title: 'Hosted access',
      text: 'An operator-issued Clawd gateway access code is stored separately from wallet identity. Signing into a wallet does not grant paid services automatically. Provider keys stay on Fly.',
    },
    {
      title: 'Exact-mint research',
      text: 'The Desk loads live market snapshots and hourly charts for the exact selected mint, including Wrapped SOL and CLAWD, with source links and retrieval times.',
    },
  ],
} as const;

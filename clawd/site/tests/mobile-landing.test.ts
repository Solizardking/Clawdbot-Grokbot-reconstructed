import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {ANDROID_CERT_SHA256,ANDROID_PACKAGE,androidAssetLinks} from '../lib/android-association';
import {mobileLanding,MOBILE_PUBLIC_PATHS} from '../lib/mobile-landing';
const root=fileURLToPath(new URL('..',import.meta.url));

it('publishes Digital Asset Links for com.clawdbot.mobile with the public release fingerprint only',()=>{
  const links=androidAssetLinks();
  expect(links[0]?.target.package_name).toBe(ANDROID_PACKAGE);
  expect(ANDROID_PACKAGE).toBe('com.clawdbot.mobile');
  expect(links[0]?.target.sha256_cert_fingerprints).toEqual([ANDROID_CERT_SHA256]);
  expect(ANDROID_CERT_SHA256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  expect(JSON.stringify(links)).not.toMatch(/keystore|storePassword|keyPassword|\.p12|\.jks/i);
  const file=JSON.parse(readFileSync(root+'/public/.well-known/assetlinks.json','utf8'));
  expect(file).toEqual(links);
});

it('describes the Solana Mobile Android product, APK path, privacy, and Expo Go limit',()=>{
  const page=readFileSync(root+'/app/mobile/page.tsx','utf8');
  expect(page).toContain("from '@/lib/mobile-landing'");
  expect(page).toContain('{mobileLanding.expoGo}');
  expect(page).toContain('{mobileLanding.privacyLabel}');
  expect(page).toContain('{mobileLanding.apkName}');
  expect(page).toContain('Solana Mobile');
  expect(page).toContain('Android');
  expect(page).toContain('Clawd');
  expect(mobileLanding.product).toMatch(/Solana Mobile/);
  expect(mobileLanding.expoGo).toMatch(/Expo Go cannot load its native wallet and crypto modules/);
  expect(mobileLanding.expoGo).not.toMatch(/Expo Go can use/);
  expect(mobileLanding.privacyHref).toBe('/privacy');
  expect(mobileLanding.apkName).toBe('clawd-mobile-0.1.0-arm64.apk');
  expect(MOBILE_PUBLIC_PATHS).toEqual(['https://x402.life/mobile','https://clawdcompute.us/mobile']);
  expect(page).not.toMatch(/Expo Go can (load|use) (its )?native/i);
});

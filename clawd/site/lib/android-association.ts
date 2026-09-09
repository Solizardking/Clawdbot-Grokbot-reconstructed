/** Public release signing certificate only. Never include keystore material. */
export const ANDROID_PACKAGE = 'com.clawdbot.mobile';
export const ANDROID_CERT_SHA256 = '51:DF:5D:32:7B:97:7C:A3:82:8E:71:28:0C:31:54:AB:7B:DE:B1:96:90:DE:19:2C:AB:CB:2B:34:C9:29:5B:98';

export function androidAssetLinks() {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: ANDROID_PACKAGE,
      sha256_cert_fingerprints: [ANDROID_CERT_SHA256],
    },
  }];
}

const { withAppBuildGradle, withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('node:fs/promises')
const path = require('node:path')
module.exports = function (config) {
  config = withAppBuildGradle(config, (mod) => {
    let text = mod.modResults.contents
    if (!text.includes('signingConfigs.clawdRelease')) {
      text = text.replace(
        'signingConfigs {',
        `signingConfigs {
        clawdRelease {
            if (System.getenv('CLAWD_ANDROID_KEYSTORE')) {
                storeFile file(System.getenv('CLAWD_ANDROID_KEYSTORE'))
                storePassword System.getenv('CLAWD_ANDROID_STORE_PASSWORD')
                keyAlias 'clawd-mobile'
                keyPassword System.getenv('CLAWD_ANDROID_KEY_PASSWORD')
            }
        }`,
      )
      text = text.replace(
        /(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        '$1signingConfig signingConfigs.clawdRelease',
      )
      text += `\n// Refuse release builds without the operator's private signing key.\ngradle.taskGraph.whenReady { graph ->\n    if (graph.allTasks.any { it.name.toLowerCase().contains('release') } && !System.getenv('CLAWD_ANDROID_KEYSTORE')) {\n        throw new GradleException('Set Clawd Android signing credentials before building a release')\n    }\n}\n`
    }
    mod.modResults.contents = text
    return mod
  })
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0]
    app.$['android:allowBackup'] = 'false'
    app.$['android:usesCleartextTraffic'] = 'false'
    app.$['android:networkSecurityConfig'] = '@xml/clawd_network_security'
    return mod
  })
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        path.join(dir, 'clawd_network_security.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain><domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>\n`,
      )
      return mod
    },
  ])
}

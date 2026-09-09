import { readFile, mkdir, copyFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('..', import.meta.url))
const credentials = JSON.parse(
  await readFile(path.resolve(root, '../.cache/clawd-mobile-signing/signing.json'), 'utf8'),
)
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME ?? '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home',
  ANDROID_HOME: process.env.ANDROID_HOME ?? path.join(process.env.HOME, 'Library/Android/sdk'),
  EXPO_NO_TELEMETRY: '1',
  NODE_ENV: 'production',
  CLAWD_ANDROID_KEYSTORE: credentials.keystore,
  CLAWD_ANDROID_STORE_PASSWORD: credentials.storePassword,
  CLAWD_ANDROID_KEY_PASSWORD: credentials.keyPassword,
}
function run(command, args, cwd = root) {
  const p = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (p.status !== 0) process.exit(p.status ?? 1)
}
if (!process.argv.includes('--skip-prebuild')) run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'])
run(
  './gradlew',
  [':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--console=plain'],
  path.join(root, 'android'),
)
await mkdir(path.join(root, 'artifacts'), { recursive: true })
await copyFile(
  path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'),
  path.join(root, 'artifacts/clawd-mobile-0.1.0-arm64.apk'),
)
console.log('Signed APK: artifacts/clawd-mobile-0.1.0-arm64.apk')

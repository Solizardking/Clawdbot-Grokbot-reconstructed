import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const apk = path.join(root, 'artifacts/clawd-mobile-0.1.0-arm64.apk')
const sdk = process.env.ANDROID_HOME ?? path.join(process.env.HOME, 'Library/Android/sdk')
const buildTools = path.join(sdk, 'build-tools/36.0.0')
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME ?? '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home',
}
const run = (name, args) => execFileSync(path.join(buildTools, name), args, { encoding: 'utf8', env })
const certificate = run('apksigner', ['verify', '--verbose', '--print-certs', apk])
const fingerprint = certificate.match(/certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1].toUpperCase()
if (!fingerprint) throw new Error('Release certificate was not found')
const association = JSON.parse(
  await readFile(path.resolve(root, '../clawd/site/public/.well-known/assetlinks.json'), 'utf8'),
)
const target = association.find((a) => a.target.package_name === 'com.clawdbot.mobile')?.target
if (!target?.sha256_cert_fingerprints.some((f) => f.replaceAll(':', '') === fingerprint))
  throw new Error('Website association does not match the APK signing key')
const badging = run('aapt', ['dump', 'badging', apk])
if (!/package: name='com\.clawdbot\.mobile' versionCode='1'/.test(badging))
  throw new Error('Unexpected release identity')
if (badging.includes('application-debuggable')) throw new Error('Debuggable APK cannot be released')
if (!badging.includes("native-code: 'arm64-v8a'")) throw new Error('Expected arm64 native libraries')
const permissions = run('aapt', ['dump', 'permissions', apk])
if (
  /android\.permission\.(RECORD_AUDIO|CAMERA|READ_MEDIA_IMAGES|READ_MEDIA_VIDEO|SYSTEM_ALERT_WINDOW|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE)/.test(permissions)
)
  throw new Error('Unexpected sensitive permission in APK')
run('zipalign', ['-c', '-P', '16', '4', apk])
const files = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' }).trim().split('\n')
if (!files.includes('assets/index.android.bundle')) throw new Error('Standalone JavaScript bundle is missing')
const bundle = execFileSync('unzip', ['-p', apk, 'assets/index.android.bundle'], {
  maxBuffer: 128 * 1024 * 1024,
}).toString('utf8')
if (/(?:sk-or-v1-|nvapi-|tvly-(?:dev|prod)-)[A-Za-z0-9_-]{20,}|prod:[a-z]+-[a-z]+-\d+\|eyJ/.test(bundle))
  throw new Error('A provider credential pattern was found in the application bundle')
if (files.some((f) => /(?:\.env|\.p12|\.jks|signing\.json|client\.env)$/.test(f)))
  throw new Error('Private configuration found in APK')
for (const file of files.filter((f) => f.startsWith('lib/arm64-v8a/') && f.endsWith('.so'))) {
  const elf = execFileSync('unzip', ['-p', apk, file], { maxBuffer: 128 * 1024 * 1024 })
  if (elf.subarray(0, 4).toString('hex') !== '7f454c46' || elf[4] !== 2 || elf[5] !== 1)
    throw new Error('Unexpected native library format')
  const offset = Number(elf.readBigUInt64LE(32)),
    size = elf.readUInt16LE(54),
    count = elf.readUInt16LE(56)
  for (let i = 0; i < count; i++) {
    const header = offset + size * i
    if (elf.readUInt32LE(header) === 1 && elf.readBigUInt64LE(header + 48) < 16384n)
      throw new Error(`Native library lacks 16 KB page alignment: ${file}`)
  }
}
const report = {
  package: 'com.clawdbot.mobile',
  version: '0.1.0',
  versionCode: 1,
  architecture: 'arm64-v8a',
  signatureVerified: true,
  websiteCertificateMatches: true,
  alignment16KB: true,
  debuggable: false,
  standaloneBundle: true,
  sha256: createHash('sha256')
    .update(await readFile(apk))
    .digest('hex'),
  certificateSha256: fingerprint,
  checkedAt: new Date().toISOString(),
  storePublished: false,
  physicalWalletTest: 'pending',
}
await writeFile(path.join(root, 'artifacts/release-verification.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))

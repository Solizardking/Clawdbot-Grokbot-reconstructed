import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--snapshot')) throw new Error('Usage: verify-desktop-release.mjs [--snapshot directory]');
const baseline = args.length ? resolve(root, args[1]) : root;
const snapshot = args.length ? JSON.parse(await readFile(join(baseline, 'snapshot.json'), 'utf8')) : null;
const require = createRequire(import.meta.url);
const { listPackage, extractFile } = require('@electron/asar');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (snapshot && snapshot.version !== version) throw new Error('Snapshot version does not match release version');
const release = join(root, 'release');
const targets = [
  ['win-x64', 'win-unpacked/resources'],
  ['linux-x64', 'linux-unpacked/resources'],
  ['mac-arm64', 'mac-arm64/Clawd Bot.app/Contents/Resources'],
  ['mac-x64', 'mac/Clawd Bot.app/Contents/Resources'],
];
async function hash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const packages = [];
for (const [target, relative] of targets) {
  const resources = join(release, relative);
  const asar = join(resources, 'app.asar');
  const names = listPackage(asar);
  if (names.some(name => /(^|\/)node_modules(\/|$)|(^|\/)\.env(?:\.|$)/.test(name))) {
    throw new Error(`${target}: unexpected dependency or environment file in ASAR`);
  }
  const metadata = JSON.parse(extractFile(asar, 'package.json').toString());
  if (metadata.version !== version) throw new Error(`${target}: obsolete packaged version`);
  if (!extractFile(asar, 'electron/main.mjs').equals(await readFile(join(baseline, snapshot ? 'main.mjs' : 'electron/main.mjs')))) {
    throw new Error(`${target}: Electron entry does not match current source`);
  }
  for (const [source, packaged] of [['dist-server/index.js','server/index.js'],['dist-ui/index.html','ui/index.html']]) {
    if (await hash(join(baseline, source)) !== await hash(join(resources, packaged))) {
      throw new Error(`${target}: ${packaged} is not the current build`);
    }
  }
  packages.push({ target, resources: relative, version, currentBuild: true });
}
const artifacts = [];
for (const file of (await readdir(release)).sort()) {
  if (!/\.(exe|zip|AppImage|deb|dmg)$/.test(file)) continue;
  if (!file.startsWith(`ClawdBot-${version}-`)) throw new Error(`Obsolete release artifact: ${file}`);
  const path = join(release, file);
  if (file.endsWith('.zip')) {
    const entries = unzipSync(await readFile(path), {filter: entry => /(?:^|\/)(?:resources|Resources)\/server\/index\.js$/.test(entry.name)});
    const servers = Object.values(entries);
    if (servers.length !== 1 || createHash('sha256').update(servers[0]).digest('hex') !== await hash(join(baseline,'dist-server/index.js'))) {
      throw new Error(`${file}: archived server does not match the release snapshot`);
    }
  }
  artifacts.push({ file, bytes: (await stat(path)).size, sha256: await hash(path) });
}
for (const suffix of ['setup.exe','win-x64.zip','linux-x86_64.AppImage','linux-amd64.deb','arm64.dmg','x64.dmg','mac-arm64.zip','mac-x64.zip']) {
  if (!artifacts.some(item => item.file === `ClawdBot-${version}-${suffix}`)) throw new Error(`Missing ${suffix} release`);
}
await writeFile(join(release, 'SHA256SUMS'), artifacts.map(item => `${item.sha256}  ${item.file}\n`).join(''));
const worktreeServerMatchesSnapshot = await hash(join(root,'dist-server/index.js')) === await hash(join(baseline,'dist-server/index.js'));
await writeFile(join(release, 'release-manifest.json'), JSON.stringify({version,verifiedAt:new Date().toISOString(),sourceSnapshot:snapshot,worktreeServerMatchesSnapshot,packages,artifacts,publicReleaseApproved:false},null,2)+'\n');
console.log(`Verified ${packages.length} current packages and hashed ${artifacts.length} artifacts. Signing, notarization and native UI acceptance remain separate checks.`);

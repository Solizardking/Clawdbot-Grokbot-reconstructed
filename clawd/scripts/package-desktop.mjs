import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCloudflared } from './prepare-cloudflared.mjs';
import { stageLinuxCua } from './cua-linux-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const [target, ...flags] = process.argv.slice(2);
if (!['win', 'linux'].includes(target) || flags.some(flag => flag !== '--skip-build')) {
  throw new Error('Usage: package-desktop.mjs win|linux [--skip-build]');
}
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (${result.status})`);
}
if (!flags.includes('--skip-build')) {
  // npm_execpath avoids Windows .cmd shell quoting and uses the calling npm.
  if (!process.env.npm_execpath) throw new Error('Run through npm run package:win or package:linux');
  run(process.env.npm_execpath, ['run', 'build']);
}
run(join(root, 'scripts/smoke-packaged-server.mjs'));
const platform = target === 'win' ? 'win32' : 'linux';
await prepareCloudflared({ root, platform, arch: 'x64' });
run(join(root, 'scripts/prepare-android-tools.mjs'), ['--platform', platform]);
if (target === 'linux') await stageLinuxCua({ rootDirectory: root, platform: 'linux', arch: 'x64' });
const builder = join(dirname(require.resolve('electron-builder/package.json')), 'out/cli/cli.js');
run(builder, [`--${target}`, '--x64', '--publish', 'never']);

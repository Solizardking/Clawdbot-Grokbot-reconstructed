import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const [rawOrigin, clientFile] = process.argv.slice(2);
const origin = new URL(rawOrigin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an HTTPS gateway origin');
const token = /^SAND_HOSTED_GATEWAY_TOKEN=([A-Za-z0-9_-]{32,128})$/m.exec(await readFile(clientFile, 'utf8'))?.[1];
if (!token) throw new Error('Client file lacks gateway token');
process.env.SAND_HOSTED_GATEWAY_URL = origin.origin;
process.env.SAND_HOSTED_GATEWAY_TOKEN = token;
const temporary = await mkdtemp(join(tmpdir(), 'hosted-e2b-smoke-'));
let bridge, started = false;
try {
  const output = join(temporary, 'e2b.cjs');
  await build({ entryPoints: ['source/node-agent-coordinator/e2b-tools.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  bridge = createRequire(import.meta.url)(output);
  const result = await bridge.executeE2bRoutedTool('e2b_computer_status', {});
  started = true;
  if (!result?.sandboxId) throw new Error('No sandbox identifier');
  const shot = await bridge.executeE2bRoutedTool('e2b_computer_screenshot', {});
  const png = Buffer.from(shot.image_base64, 'base64');
  if (png.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Screenshot is not a PNG');
  const command = await bridge.executeE2bRoutedTool('e2b_computer_run_command', {
    command: 'python3 -c "import os; keys=[\'E2B_API_KEY\',\'OPENROUTER_API_KEY\',\'HELIUS_API_KEY\',\'BROWSER_USE_API_KEY\',\'GATEWAY_USERS_JSON\']; print(\'operator-env-absent\' if not any(os.getenv(k) for k in keys) else \'unexpected-env\')"',
  });
  if (command.exitCode !== 0 || command.stdout.trim() !== 'operator-env-absent') throw new Error('Sandbox environment isolation check failed');
  console.log('PASS: actual desktop tool created an owned E2B sandbox, captured a PNG, and verified operator credentials are absent from its environment.');
} finally {
  try {
    if (started) {
      await bridge.executeE2bRoutedTool('e2b_computer_stop', {});
      console.log('PASS: owned E2B sandbox stopped through Fly.');
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

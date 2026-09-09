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
const temporary = await mkdtemp(join(tmpdir(), 'hosted-browser-smoke-'));
let id, bridge;
try {
  const output = join(temporary, 'browser.cjs');
  await build({ entryPoints: ['source/node-agent-coordinator/browser-use-tools.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  bridge = createRequire(import.meta.url)(output);
  const created = await bridge.executeBrowserUseRoutedTool('browseruse_launch_browser', { proxy_country_code: null });
  id = created?.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Browser creation did not return a valid id');
  let protocol;
  try { protocol = new URL(created.cdpUrl).protocol; } catch {}
  if (!['wss:', 'https:'].includes(protocol)) {
    console.error(JSON.stringify({ cdpType: typeof created.cdpUrl, cdpProtocol: protocol, status: created.status }));
    throw new Error('Browser creation did not return a secure CDP connection');
  }
  console.log('PASS: real desktop Browser Use tool created an owned hosted browser using only the gateway token.');
} finally {
  try {
    if (id) {
      await bridge.executeBrowserUseRoutedTool('browseruse_stop_browser', { id });
      console.log('PASS: owned browser stopped through the gateway.');
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

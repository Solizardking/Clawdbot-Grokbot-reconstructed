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
const temporary = await mkdtemp(join(tmpdir(),'hosted-hop-smoke-'));
let bridge;
try {
  const output = join(temporary,'hop.cjs');
  await build({ stdin: { contents: 'export { executeCloudBoxRoutedTool } from "./source/node-agent-coordinator/cloud-box-tools.ts"; export { executeE2bRoutedTool } from "./source/node-agent-coordinator/e2b-tools.ts";', resolveDir: process.cwd() }, outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', define: { 'import.meta.url': '__moduleUrl' }, banner: { js: 'const __moduleUrl = require("node:url").pathToFileURL(__filename).href;' } });
  bridge = createRequire(import.meta.url)(output);
  const result = await bridge.executeCloudBoxRoutedTool('cloud_box_install_hop',{});
  if (!result?.ok || result.files?.length !== 2) throw new Error('Hop installation was not verified');
  console.log('PASS: actual cloud-box installer transferred both hop files and verified their hashes and Node syntax through the hosted E2B broker.');
} finally {
  try {
    if (bridge) {
      await bridge.executeE2bRoutedTool('e2b_computer_stop',{});
      console.log('PASS: hosted hop smoke desktop stopped.');
    }
  } finally { await rm(temporary,{recursive:true,force:true}); }
}

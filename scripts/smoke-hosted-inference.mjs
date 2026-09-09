import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const [rawOrigin, clientFile, provider = 'openrouter', model = provider === 'xai' ? 'grok-4.6' : 'openrouter/free'] = process.argv.slice(2);
if (!['openrouter','xai'].includes(provider)) throw new Error('Unsupported inference smoke provider');
const origin = new URL(rawOrigin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an HTTPS gateway origin');
const client = await readFile(clientFile, 'utf8');
const token = /^SAND_HOSTED_GATEWAY_TOKEN=([A-Za-z0-9_-]{32,128})$/m.exec(client)?.[1];
if (!token) throw new Error('Client file lacks gateway token');
const temporary = await mkdtemp(join(tmpdir(),'hosted-inference-smoke-'));
process.env.SAND_HOSTED_GATEWAY_URL = origin.origin;
process.env.SAND_HOSTED_GATEWAY_TOKEN = token;
process.env.SAND_DATA_ROOT = temporary;
process.env.OPENROUTER_MODEL = model;
process.env.SAND_XAI_MODEL = model;
delete process.env.OPENROUTER_API_KEY;
delete process.env.XAI_API_KEY;
const originalFetch = globalThis.fetch;
let requests = 0, deltas = 0;
try {
  globalThis.fetch = async (input,init) => {
    const request = new Request(input,init);
    if (request.url !== origin.origin+'/'+provider+'/v1/chat/completions' || request.headers.get('authorization') !== 'Bearer '+token) throw new Error('Unexpected inference destination or credential');
    requests++;
    return originalFetch(request);
  };
  const output = join(temporary,'inference.cjs');
  await build({ entryPoints: ['source/host/extensions/inference/provider-session.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', define: { 'import.meta.url': '__moduleUrl' }, banner: { js: 'const __moduleUrl = require("node:url").pathToFileURL(__filename).href;' } });
  const bridge = createRequire(import.meta.url)(output);
  const result = await bridge.runRoutedProviderText(provider,[{role:'user',content:'Reply with exactly READY. No other text.'}],{onTextDelta:()=>{deltas++;}});
  if (result.trim() !== 'READY' || !requests || !deltas) throw new Error('Inference output or streaming assertion failed');
  console.log('PASS: actual provider-session runtime streamed the expected reply through Fly using only the user token.');
} catch {
  console.error('Hosted inference smoke failed; provider diagnostics suppressed to keep request credentials private.');
  process.exitCode=1;
} finally { globalThis.fetch=originalFetch; await rm(temporary,{recursive:true,force:true}); }

import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseHostedAccessFile } from './lib/hosted-access-file.mjs';
const [clientFile, configFile] = process.argv.slice(2);
if (!clientFile || !configFile) throw new Error('Usage: connect-clawd-composio.mjs CLIENT_ENV CONFIG_FILE');
const access = parseHostedAccessFile(await readFile(clientFile, 'utf8'));
const check = await fetch(access.url + '/composio/v1/connectors/connected', { headers: { authorization: `Bearer ${access.token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
if (!check.ok || !(await check.json()).services?.custom_solgpt?.connected) throw new Error('Hosted SOLgpt connection is not ready');
const original = await readFile(configFile, 'utf8'), config = JSON.parse(original);
if (config.openaiCompat?.key !== access.token || config.openaiCompat?.url !== access.url + '/openrouter/v1') throw new Error('Clawd uses a different hosted account');
config.composio = { ...config.composio, hostedGateway: true };
const enabled = [];
for (const [id, engine] of Object.entries(config.instances ?? {})) {
  if (engine.driver !== 'openai-compat') continue;
  const url = engine.config?.url ?? config.openaiCompat.url;
  if (url === access.url + '/novita/v1') { engine.config = { ...engine.config, financeResearch: true }; continue; }
  if (![access.url + '/openrouter/v1', access.url + '/xai/v1'].includes(url)) continue;
  engine.config = { ...engine.config, hostedComposio: true, hostedMarket: true, hostedPump: true, hostedSandbox: true, financeResearch: true }; enabled.push(id);
}
await writeFile(configFile + '.before-hosted-composio', original, { mode: 0o600, flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
await writeFile(configFile + '.composio.tmp', JSON.stringify(config, null, 2), { mode: 0o600 });
await rename(configFile + '.composio.tmp', configFile);
const reloaded = await fetch('http://127.0.0.1:8799/api/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ composio: { hostedGateway: true } }), signal: AbortSignal.timeout(30000) });
if (!reloaded.ok) throw new Error('Clawd could not reload hosted Composio');
console.log(JSON.stringify({ connected: true, toolkit: 'custom_solgpt', version: '20260824_02', engines: enabled }));

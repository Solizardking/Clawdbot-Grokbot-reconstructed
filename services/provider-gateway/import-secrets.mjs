import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Explicitly import only provider keys, never the caller's entire environment.
const [app, policyFile] = process.argv.slice(2);
if (!app || !/^[a-z0-9-]+$/.test(app) || !policyFile) {
  console.error('Usage: node services/provider-gateway/import-secrets.mjs FLY_APP COMPLETE_USER_POLICY_JSON');
  process.exit(1);
}
const policy = JSON.parse(await readFile(policyFile, 'utf8'));
const entries = Object.fromEntries(['OPENROUTER_API_KEY', 'XAI_API_KEY', 'HELIUS_API_KEY', 'BROWSER_USE_API_KEY', 'E2B_API_KEY', 'BIRDEYE_API_KEY','NOVITA_API_KEY','TAVILY_API_KEY','COMPOSIO_API_KEY'].filter(k => process.env[k]?.trim()).map(k => [k, process.env[k].trim()]));
if (!Object.keys(entries).length || Object.values(entries).some(v => /[\r\n\x00]/.test(v))) throw new Error('Missing or invalid provider environment keys');
entries.GATEWAY_USERS_JSON = JSON.stringify(policy);
// Values travel over stdin, never command arguments or console output.
const result = spawnSync('fly', ['secrets', 'import', '--stage', '-a', app], {
  input: Object.entries(entries).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
if (result.status !== 0) { console.error('Fly secret import failed; no secret values or CLI output printed.'); process.exit(1); }
console.log('Provider credentials and complete user policy staged on Fly.');

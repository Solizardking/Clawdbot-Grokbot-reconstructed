import { spawnSync } from 'node:child_process';

const [sourceApp, targetApp, key] = process.argv.slice(2);
if (![sourceApp, targetApp].every(name => typeof name === 'string' && /^[a-z0-9-]+$/.test(name)) ||
    sourceApp === targetApp || !['HELIUS_API_KEY', 'XAI_API_KEY', 'OPENROUTER_API_KEY', 'BROWSER_USE_API_KEY', 'E2B_API_KEY'].includes(key)) {
  throw new Error('Usage: copy-provider-secret.mjs SOURCE_APP TARGET_APP PROVIDER_KEY_NAME');
}
// Capture remotely read value in memory; never emit fly output or put values
// in arguments, files, logs, or the terminal. Wallet/session keys are excluded.
const read = spawnSync('fly', ['ssh', 'console', '-a', sourceApp, '-C', `printenv ${key}`], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
});
const value = read.stdout?.trim();
if (read.status !== 0 || !value || /\s|\x00/.test(value)) throw new Error('Provider secret could not be read; captured output suppressed');
const write = spawnSync('fly', ['secrets', 'import', '--stage', '-a', targetApp], {
  input: `${key}=${value}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
});
if (write.status !== 0) throw new Error('Provider secret import failed; captured output suppressed');
console.log('Selected provider secret staged on the target app; value not printed.');

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [app, clientFile, service, policyFile] = process.argv.slice(2);
if (!app || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(app) || !clientFile || !policyFile ||
    !service?.split(',').every(item => ['helius', 'browseruse', 'e2b', 'media', 'birdeye', 'tavily', 'composio', 'market', 'pump', 'sandbox', 'solana'].includes(item))) throw new Error('Usage: grant-service.mjs APP CLIENT_ENV SERVICE POLICY_OUTPUT');
const access = parseHostedAccessFile(await readFile(clientFile, 'utf8'));
const digest = createHash('sha256').update(access.token).digest('hex');
const current = spawnSync('fly', ['ssh', 'console', '--app', app, '--command', 'printenv GATEWAY_USERS_JSON'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
if (current.status !== 0) throw new Error('Cannot read live policy; CLI diagnostics suppressed');
const policy = JSON.parse(current.stdout.trim());
if (!Object.hasOwn(policy, digest) || !policy[digest]?.id) throw new Error('Access token is not registered');
policy[digest].services = [...new Set([...(policy[digest].services ?? []), ...service.split(',')])];
const serialized = JSON.stringify(policy);
const result = spawnSync('fly', ['secrets', 'import', '--stage', '--app', app], {input: `GATEWAY_USERS_JSON=${serialized}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
if (result.status !== 0) throw new Error('Cannot stage service grant; CLI diagnostics suppressed');
await writeFile(policyFile, serialized + '\n', {mode: 0o600});
console.log('Staged service grant, preserving other users and existing runtime assignments.');

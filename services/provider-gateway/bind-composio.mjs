import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';
import { validateComposioBinding } from './composio.mjs';
const [app, clientFile, userId, accountId, authConfigId, policyFile] = process.argv.slice(2);
const binding = { userId, accountId, authConfigId };
if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(app ?? '') || !clientFile || !policyFile || !validateComposioBinding(binding)) throw new Error('Usage: bind-composio.mjs APP CLIENT_ENV COMPOSIO_USER ACCOUNT_ID AUTH_CONFIG_ID POLICY_OUTPUT');
const access = parseHostedAccessFile(await readFile(clientFile, 'utf8'));
const digest = createHash('sha256').update(access.token).digest('hex');
const current = spawnSync('fly', ['ssh', 'console', '--app', app, '--command', 'printenv GATEWAY_USERS_JSON'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (current.status !== 0) throw new Error('Cannot read live policy; CLI diagnostics suppressed');
const policy = JSON.parse(current.stdout.trim());
if (!Object.hasOwn(policy, digest)) throw new Error('Access token is not registered');
for (const [otherDigest, user] of Object.entries(policy)) {
  if (otherDigest !== digest && user.id !== policy[digest].id &&
      (user.composio?.userId === userId || user.composio?.accountId === accountId)) throw new Error('Private Composio binding belongs to another gateway user');
}
policy[digest].services = [...new Set([...(policy[digest].services ?? []), 'composio'])];
policy[digest].composio = binding;
const serialized = JSON.stringify(policy);
const result = spawnSync('fly', ['secrets', 'import', '--stage', '--app', app], { input: `GATEWAY_USERS_JSON=${serialized}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
if (result.status !== 0) throw new Error('Cannot stage Composio binding; diagnostics suppressed');
await writeFile(policyFile, serialized + '\n', { mode: 0o600 });
console.log('Staged owner Composio connection, preserving the live user registry.');

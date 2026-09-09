import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [gatewayApp, clientFile, runtimeApp, policyFile] = process.argv.slice(2);
for (const app of [gatewayApp,runtimeApp]) if (!app || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(app)) throw new Error('Invalid Fly app name');
if (!clientFile || !policyFile) throw new Error('Usage: assign-runtime.mjs GATEWAY_APP CLIENT_ENV RUNTIME_APP POLICY_OUTPUT');
const access = parseHostedAccessFile(await readFile(clientFile,'utf8'));
const digest = createHash('sha256').update(access.token).digest('hex');
// Merge into the live registry, preserving other users and all current grants.
const current = spawnSync('fly',['ssh','console','--app',gatewayApp,'--command','printenv GATEWAY_USERS_JSON'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
if (current.status !== 0) throw new Error('Cannot read live gateway policy; CLI diagnostics suppressed');
const policy = JSON.parse(current.stdout.trim());
if (!Object.hasOwn(policy,digest) || !policy[digest]?.id) throw new Error('Access token is not in the live gateway policy');
for (const entry of Object.values(policy)) if (entry.runtimeApp === runtimeApp && entry.id !== policy[digest].id) throw new Error('Runtime already belongs to another user');
policy[digest] = {...policy[digest],runtimeApp};
const serialized = JSON.stringify(policy);
const imported = spawnSync('fly',['secrets','import','--stage','--app',gatewayApp],{input:`GATEWAY_USERS_JSON=${serialized}\n`,encoding:'utf8',stdio:['pipe','pipe','pipe']});
if (imported.status !== 0) throw new Error('Cannot stage runtime assignment; CLI diagnostics suppressed');
await writeFile(policyFile,serialized+'\n',{mode:0o600});
console.log('Staged the user runtime assignment while preserving the live registry.');

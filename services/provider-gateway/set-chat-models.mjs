import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [app, clientFile, provider, model, policyFile, grant, ...extra] = process.argv.slice(2);
if (!app || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(app) || !clientFile || !policyFile || !['openrouter','xai','novita','nvidia'].includes(provider) || !model) throw new Error('Usage: set-chat-models.mjs APP CLIENT_ENV PROVIDER MODEL POLICY_OUTPUT');
const access = parseHostedAccessFile(await readFile(clientFile, 'utf8'));
const digest = createHash('sha256').update(access.token).digest('hex');
const current = spawnSync('fly', ['ssh','console','--app',app,'--command','printenv GATEWAY_USERS_JSON'], {encoding:'utf8',stdio:['ignore','pipe','pipe']});
if (current.status !== 0) throw new Error('Cannot read live policy; CLI diagnostics suppressed');
const policy = JSON.parse(current.stdout.trim());
if (!Object.hasOwn(policy,digest) || !Array.isArray(policy[digest]?.models)) throw new Error('User is not registered');
if (extra.length % 2) throw new Error('Additional models require PROVIDER MODEL pairs');
for (const [selectedProvider, selectedModel] of [[provider, model], ...Array.from({length:extra.length/2},(_,i)=>[extra[i*2],extra[i*2+1]])]) {
if (!['openrouter','xai','novita','nvidia'].includes(selectedProvider) || !selectedModel) throw new Error('Invalid additional model');
if (!policy[digest].models.includes(selectedModel)) {
  if (grant !== '--grant') throw new Error('Model must already be granted; use --grant for an explicitly authorized new model');
  policy[digest].models.push(selectedModel);
}
const user = policy[digest];
user.chatModels = {...user.chatModels, [selectedProvider]: [...new Set([...(user.chatModels?.[selectedProvider] ?? []), selectedModel])]};
}
const serialized = JSON.stringify(policy);
const result = spawnSync('fly',['secrets','import','--stage','--app',app],{input:`GATEWAY_USERS_JSON=${serialized}\n`,encoding:'utf8',stdio:['pipe','pipe','pipe']});
if (result.status !== 0) throw new Error('Cannot stage chat catalog; CLI diagnostics suppressed');
await writeFile(policyFile,serialized+'\n',{mode:0o600});
console.log('Staged the authorized chat model for compatible clients; preserved the live user registry.');

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [id, model, output, gatewayUrl = 'https://grok-provider-gateway-8bit.fly.dev'] = process.argv.slice(2);
if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !model || !/^[A-Za-z0-9_./:-]{1,200}$/.test(model) || /[\r\n]/.test(gatewayUrl) || !output) {
  console.error('Usage: node services/provider-gateway/issue-user.mjs USER_ID MODEL NEW_PRIVATE_DIRECTORY [GATEWAY_ORIGIN]');
  process.exit(1);
}
const directory = resolve(output);
const token = randomBytes(32).toString('base64url');
const digest = createHash('sha256').update(token).digest('hex');
const access = parseHostedAccessFile(`SAND_HOSTED_GATEWAY_URL=${gatewayUrl}\nSAND_HOSTED_GATEWAY_TOKEN=${token}\nOPENROUTER_MODEL=${model}\n`);
await mkdir(directory, { mode: 0o700 }); // fail rather than overwrite an existing token
await writeFile(join(directory, 'client.env'), `SAND_HOSTED_GATEWAY_URL=${access.url}\nSAND_HOSTED_GATEWAY_TOKEN=${token}\nOPENROUTER_MODEL=${access.model}\n`, { mode: 0o600, flag: 'wx' });
await writeFile(join(directory, 'user-policy.json'), JSON.stringify({ [digest]: { id, models: [model] } }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log('Created client.env and user-policy.json in the requested private directory. Token values were not printed.');

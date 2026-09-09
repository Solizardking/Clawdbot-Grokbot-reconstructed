import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [app, clientFile] = process.argv.slice(2);
if (!app || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(app) || !clientFile) throw new Error('Usage: import-access.mjs APP CLIENT_ENV_FILE');
const access = parseHostedAccessFile(await readFile(clientFile,'utf8'));
const child = spawn('fly',['secrets','import','--stage','--app',app],{stdio:['pipe','pipe','pipe']});
// Never place credential values in argv, output, or build files.
child.stdout.resume(); child.stderr.resume();
child.stdin.on('error',()=>{});
child.stdin.end(`SAND_GATEWAY_TOKEN=${access.token}\nSAND_HOSTED_GATEWAY_TOKEN=${access.token}\n`);
child.once('error',()=>{console.error('Could not start Fly secret import.');process.exitCode=1;});
child.once('close',code=>{
  if (code !== 0) {console.error('Fly runtime secret import failed; diagnostics suppressed.');process.exitCode=1;}
  else console.log('Staged owner access on the runtime; no provider keys copied.');
});

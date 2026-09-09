import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,unlink,chmod,open,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

const allowed=new Set(['NVIDIA_API_KEY','SOLANA_TRACKER_SECURE_RPC','SOLANA_TRACKER_RPC_URL','SOLANA_TRACKER_WSS_URL','SOLANA_TRACKER_ACCESS_KEY','SOLANA_RPC_URL','RPC_URL','ACCESS_KEY']);
export function validateInfrastructure(values) {
  if(!values||Array.isArray(values)||typeof values!=='object'||!Object.keys(values).length||Object.entries(values).some(([key,value])=>!allowed.has(key)||typeof value!=='string'||!value.trim()||value.length>8192||/[\r\n\0]/.test(value)))throw new Error('Invalid infrastructure settings; values suppressed');
  return values;
}
function parsePrivateFile(text) {
  const values=Object.create(null);
  for(const line of text.split(/\r?\n/)) {
    if(!line)continue;
    const separator=line.indexOf('=');
    const key=line.slice(0,separator);
    if(separator<1||Object.hasOwn(values,key))throw new Error('Invalid private infrastructure file; values suppressed');
    values[key]=line.slice(separator+1);
  }
  return Object.keys(values).length?validateInfrastructure(values):values;
}
const serialize=values=>Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join('');
function stageOnFly(text) {
  const result=spawnSync('fly',['secrets','import','--stage','--app','grok-provider-gateway-8bit'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']});
  if(result.status!==0)throw new Error('Fly secret import failed; value output suppressed');
}
export async function stageInfrastructure(values,{directory=resolve('.cache/clawd-infrastructure'),stage=stageOnFly}={}) {
  validateInfrastructure(values);
  await mkdir(directory,{recursive:true,mode:0o700});
  if((await lstat(directory)).isSymbolicLink())throw new Error('Private infrastructure directory must not be a symlink');
  await chmod(directory,0o700);
  const lockPath=join(directory,'.import.lock');
  const lock=await open(lockPath,'wx',0o600).catch(()=>{throw new Error('Infrastructure import is locked; inspect the existing import before retrying');});
  const file=join(directory,'runtime.env'),temporary=join(directory,`.runtime-${randomUUID()}.tmp`);
  try {
    let current={};
    try {
      const info=await lstat(file);
      if(!info.isFile()||info.isSymbolicLink())throw new Error('Private infrastructure file must be a regular file');
      await chmod(file,0o600);
      current=parsePrivateFile(await readFile(file,'utf8'));
    }catch(error){if(error.code!=='ENOENT')throw error;}
    // Partial updates retain all other local settings. Only the requested
    // changes are sent to Fly, preserving independently managed Fly secrets.
    await writeFile(temporary,serialize({...current,...values}),{mode:0o600,flag:'wx'});
    await stage(serialize(values));
    try {await rename(temporary,file);}
    catch {throw new Error('Fly secrets were staged, but the private local copy could not be replaced');}
  }finally {
    await unlink(temporary).catch(()=>{});
    await lock.close();await unlink(lockPath);
  }
}
async function main() {
  if(!process.stdin.isTTY)throw new Error('Use hidden interactive input');
  process.stdout.write('Infrastructure JSON (hidden): ');process.stdin.setRawMode(true);process.stdin.resume();
  let input='';
  try {
    const text=await new Promise((accept,reject)=>{
      const read=chunk=>{
        for(const char of String(chunk)) {
          if(char==='\u0003'||char==='\u0004'){process.stdin.off('data',read);reject(new Error('Import cancelled'));return;}
          if(char==='\r'||char==='\n'){process.stdin.off('data',read);accept(input);return;}
          if(char==='\u007f')input=input.slice(0,-1);else if(char>=' ')input+=char;
          if(input.length>65536){process.stdin.off('data',read);reject(new Error('Input too large'));return;}
        }
      };
      process.stdin.on('data',read);
    });
    let values;
    try{values=JSON.parse(text);}catch{throw new Error('Invalid JSON; values suppressed');}
    await stageInfrastructure(values);
    console.log('\nPrivate infrastructure settings staged on Fly; existing settings retained.');
  }finally {input='';process.stdin.setRawMode(false);process.stdin.pause();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('\n'+(error.message.startsWith('Invalid')||error.message.startsWith('Fly')||error.message.startsWith('Infrastructure')||error.message.startsWith('Private')||['Import cancelled','Input too large','Use hidden interactive input'].includes(error.message)?error.message:'Infrastructure import failed; diagnostics suppressed'));process.exitCode=1;});

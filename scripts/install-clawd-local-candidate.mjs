import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,rename,mkdir,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
// Preserve verified Developer ID signatures; use ad-hoc signing only for local unsigned candidates.
const root=resolve(import.meta.dirname,'..');
const source=join(root,'clawd/release/mac-arm64/Clawd Bot.app');
const target='/Applications/Clawd Bot.app';
const staged='/Applications/.Clawd Bot candidate.app';
const backup=join(root,'.cache/clawd-installed-backup-'+Date.now()+'.app');
const config=join(homedir(),'Library/Application Support/clawd-bot/workspace/config.json');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(process.arch,'arm64','This local installer is for the Apple Silicon machine');
try{await lstat(staged);throw new Error('A staged app already exists; inspect it before retrying');}catch(error){if(error.code!=='ENOENT')throw error;}
const before=digest(await readFile(config));
const response=await fetch('http://127.0.0.1:8799/api/bots',{signal:AbortSignal.timeout(10000)});
assert.ok(response.ok,'Cannot verify running-agent state');
assert.ok(!(await response.json()).bots.some(bot=>bot.busy),'Wait for running agents before updating');
execFileSync('/usr/bin/ditto',[source,staged]);
const signature=spawnSync('/usr/bin/codesign',['-dvv',staged],{encoding:'utf8'});
const verified=spawnSync('/usr/bin/codesign',['--verify','--deep','--strict',staged],{encoding:'utf8'}).status===0;
if(!verified||!/Authority=Developer ID Application:/.test(signature.stderr??''))execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements',staged],{stdio:'pipe'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',staged],{stdio:'pipe'});
console.log('Staged complete app and verified local signature integrity.');
execFileSync('/usr/bin/osascript',['-e','tell application "Clawd Bot" to quit'],{stdio:'pipe'});
const deadline=Date.now()+20000;
while(Date.now()<deadline){
  let running=false;
  try{execFileSync('/usr/bin/pgrep',['-f','^/Applications/Clawd Bot.app/Contents/MacOS/Clawd Bot$'],{stdio:'pipe'});running=true;}catch{}
  if(!running)break;
  await new Promise(resolve=>setTimeout(resolve,300));
}
try{execFileSync('/usr/bin/pgrep',['-f','^/Applications/Clawd Bot.app/Contents/MacOS/Clawd Bot$'],{stdio:'pipe'});throw new Error('Clawd is still running; update not installed');}catch(error){if(error.status!==1)throw error;}
await mkdir(join(root,'.cache'),{recursive:true});
await rename(target,backup);
try{await rename(staged,target);}catch(error){await rename(backup,target);throw error;}
assert.equal(digest(await readFile(config)),before,'Unexpected configuration change');
execFileSync('/usr/bin/open',[target]);
console.log(JSON.stringify({installed:target,configurationPreserved:true,backup,publicRelease:false}));

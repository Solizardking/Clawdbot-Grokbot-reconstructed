import { spawnSync } from 'node:child_process';

const [app, name] = process.argv.slice(2);
if (!/^[a-z][a-z0-9-]+$/.test(app || '') || !['OPENROUTER_API_KEY','XAI_API_KEY','HELIUS_API_KEY','BROWSER_USE_API_KEY','E2B_API_KEY','BIRDEYE_API_KEY','NOVITA_API_KEY','TAVILY_API_KEY','COMPOSIO_API_KEY'].includes(name)) {
  throw new Error('Usage: node import-key.mjs FLY_APP PROVIDER_KEY_NAME (value via stdin)');
}
const interactive=process.stdin.isTTY;
if (interactive) { process.stdin.setRawMode(true); console.log('Ready for hidden secret input.'); }
const value=await new Promise((resolve,reject)=>{
  let input='';
  const finish=()=>{process.stdin.pause();if(interactive)process.stdin.setRawMode(false);resolve(input.trim());};
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',chunk=>{
    input+=chunk;
    if(input.length>4096 || input.includes('\u0003')) {process.stdin.pause();if(interactive)process.stdin.setRawMode(false);reject(new Error('Secret input rejected'));return;}
    if(interactive && /[\r\n]/.test(input))finish();
  });
  process.stdin.on('end',finish);
});
if (!value || /[\r\n\x00]/.test(value)) throw new Error('Invalid secret input');
const result=spawnSync('fly',['secrets','import','--stage','--app',app],{input:`${name}=${value}\n`,encoding:'utf8',stdio:['pipe','pipe','pipe']});
if(result.status!==0) { console.error('Fly secret import failed; diagnostics suppressed.');process.exitCode=1; }
else console.log(`${name} staged on Fly; no value printed or saved locally.`);

import { spawnSync } from 'node:child_process';
const [app] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(app ?? '')) throw new Error('Use a Fly application name');
const code = `(async()=>{
const r=await fetch("https://openrouter.ai/api/v1/credits",{headers:{authorization:"Bearer "+process.env.OPENROUTER_API_KEY},signal:AbortSignal.timeout(15000)});
const j=await r.json();
const d=j.data;
console.log(JSON.stringify({http:r.status,remainingCredits:d&&typeof d.total_credits==="number"&&typeof d.total_usage==="number"?d.total_credits-d.total_usage:null}));
})().catch(()=>{console.log(JSON.stringify({error:"Account inspection failed"}));process.exitCode=1;});`;
const quoted = "'" + code.replaceAll("'", "'\\''") + "'";
const result=spawnSync('fly',['ssh','console','-a',app,'-C','node -e '+quoted],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
if(result.status!==0)throw new Error('Account inspection failed; captured CLI output suppressed');
const parsed=JSON.parse(result.stdout.trim());
console.log(JSON.stringify({http:parsed.http,remainingCredits:parsed.remainingCredits}));

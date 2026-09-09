import { readFile } from 'node:fs/promises';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [file, mode] = process.argv.slice(2);
const access=parseHostedAccessFile(await readFile(file,'utf8'));
async function call(path,body) {
  const response=await fetch(access.url+path,{method:'POST',headers:{authorization:`Bearer ${access.token}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45_000)});
  if (!response.ok) throw new Error(`Hosted turn ${path}: HTTP ${response.status}`);
  return response.json();
}
try {
  let agents=await call('/api/listAgents',{});
  let agent=agents.find(a=>a.name==='Hosted runtime check');
  if (!agent && mode==='--start') {
    const created=await call('/api/createAgent',{name:'Hosted runtime check',description:'Verify server-side hosted conversation persistence.',origin:'user',isKickstartRequested:false,avatarShape:'blob',avatarColor:'blue'});
    agent=created.agent??created;
  }
  if (!agent) throw new Error('Hosted runtime test bot is missing');
  if (mode==='--start') {
    await call('/api/sendPrompt',{agentId:agent.id,prompt:'Reply with exactly READY. No other text.',clientNonce:'hosted-runtime-ready-check-v1'});
    console.log('Hosted turn accepted; use --check to inspect completion without resending.');
  }
  const transcript=await call('/api/getAgentTranscript',{id:agent.id});
  const encoded=JSON.stringify(transcript);
  console.log(JSON.stringify({entries:transcript.length,promptRetained:encoded.includes('Reply with exactly READY. No other text.'),readyReplyRetained:encoded.includes('"READY"')}));
  agents=await call('/api/listAgents',{});
  agent=agents.find(a=>a.id===agent.id);
  console.log(JSON.stringify({isRunning:agent?.isRunning,isRunningTurn:agent?.isRunningTurn}));
} catch(error) {
  console.error(error instanceof Error ? error.message : 'Hosted turn check failed; diagnostics suppressed');
  process.exitCode=1;
}

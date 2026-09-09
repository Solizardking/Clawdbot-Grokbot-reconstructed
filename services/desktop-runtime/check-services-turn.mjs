import { readFile } from 'node:fs/promises';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [file, mode = '--check'] = process.argv.slice(2);
if (!['--start','--check'].includes(mode)) throw new Error('Use --start once, then --check');
const access = parseHostedAccessFile(await readFile(file,'utf8'));
async function call(path,body) {
  const response=await fetch(access.url+path,{method:'POST',headers:{authorization:`Bearer ${access.token}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`Hosted service turn ${path}: HTTP ${response.status}`);
  return response.json();
}
let agents=await call('/api/listAgents',{});
let agent=agents.find(a=>a.name==='Hosted tool check');
if (!agent && mode==='--start') {
  const created=await call('/api/createAgent',{name:'Hosted tool check',description:'Verify native hosted tool discovery, execution and persistence.',origin:'user',isKickstartRequested:false,avatarShape:'blob',avatarColor:'blue'});
  agent=created.agent??created;
}
if (!agent) throw new Error('Hosted tool test bot is missing');
if (mode==='--start') {
  await call('/api/setHostSettings',{inferenceProvider:'openrouter',inferenceRouterModel:access.model});
  await call('/api/sendPrompt',{agentId:agent.id,prompt:'Use the connected hosted-services tools to call hosted_services_status once. Do not call any other provider service. Report only the configured service names returned by that tool, then append the marker HOSTED_TOOLS_READY. Use tool discovery if needed.',clientNonce:'hosted-services-native-check-v4'});
  console.log('Hosted tool turn accepted. Use --check to inspect without resending.');
}
const transcript=await call('/api/getAgentTranscript',{id:agent.id});
const encoded=JSON.stringify(transcript);
const latestUserIndex=transcript.findLastIndex(entry=>entry.clientNonce==='hosted-services-native-check-v4');
const currentTurn=latestUserIndex<0?[]:transcript.slice(latestUserIndex+1);
const outline=await call('/api/getConversationOutline',{id:agent.id});
agents=await call('/api/listAgents',{});
agent=agents.find(a=>a.id===agent.id);
console.log(JSON.stringify({entries:transcript.length,kinds:[...new Set(transcript.map(entry=>entry.kind))],isRunning:agent?.isRunning,isRunningTurn:agent?.isRunningTurn,
  markerPresent:currentTurn.some(entry=>(entry.kind==='send-message' || entry.role==='assistant') && JSON.stringify(entry).includes('HOSTED_TOOLS_READY')),
  pendingApprovals:currentTurn.filter(entry=>entry.message?.type==='auto-review-approval').map(entry=>({entryId:entry.id,...entry.message.approval})),
  toolRecordsMentionStatus:outline.some(entry=>entry.kind==='tool-call' && JSON.stringify(entry).includes('hosted_services_status')),
  toolCalls:outline.filter(entry=>entry.kind==='tool-call').map(entry=>({name:entry.name,status:entry.status,summary:entry.summary})),
  assistantReplies:currentTurn.filter(entry=>entry.kind==='send-message' || entry.role==='assistant').map(entry=>entry.message?.content ?? entry.content),
  hasError:encoded.includes('"kind":"error"')}));

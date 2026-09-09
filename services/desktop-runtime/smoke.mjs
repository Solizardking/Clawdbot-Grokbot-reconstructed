import { readFile } from 'node:fs/promises';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [clientFile, mode] = process.argv.slice(2);
const access = parseHostedAccessFile(await readFile(clientFile,'utf8'));
const request = async (path, body, token = access.token) => {
  const response = await fetch(access.url+path,{
    method:body === undefined ? 'GET':'POST', redirect:'error', signal:AbortSignal.timeout(45_000),
    headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  if (!response.ok) throw new Error(`Runtime ${path} failed (HTTP ${response.status}); response suppressed`);
  return response.json();
};
try {
  const discovery = await request('/v1/runtime');
  if (discovery.transport !== 'gateway') throw new Error('Missing private runtime transport');
  const denied = await fetch(access.url+'/api/listAgents',{method:'POST',headers:{authorization:'Bearer '+'z'.repeat(43)},body:'{}',redirect:'error',signal:AbortSignal.timeout(20000)});
  if (denied.status !== 401) throw new Error('Unauthenticated runtime access was not rejected');
  const health = await request('/health');
  if (health.ok !== true) throw new Error('Runtime health did not pass');
  const agents = await request('/api/listAgents',{});
  if (!Array.isArray(agents)) throw new Error('Runtime agent list has an unexpected shape');
  if (mode === '--create') {
    let agent = agents.find(agent=>agent.name === 'Hosted setup check');
    if (!agent) {
      const created = await request('/api/createAgent',{name:'Hosted setup check',description:'Verify hosted setup.',origin:'user',isKickstartRequested:false,avatarShape:'blob',avatarColor:'blue'});
      agent = created?.agent ?? created;
    }
    if (typeof agent?.id !== 'string') throw new Error('Runtime did not return a created agent');
    const after = await request('/api/listAgents',{});
    if (!after.some(item=>item.id === agent.id)) throw new Error('Created agent was not retained');
    console.log('PASS: private Fly runtime created and retained the hosted test bot.');
  }
  if (mode === '--transcript') {
    const agent = agents.find(agent=>agent.name === 'Hosted setup check');
    if (!agent) throw new Error('Hosted test bot is missing');
    const transcript = await request('/api/getAgentTranscript',{id:agent.id});
    const encoded = JSON.stringify(transcript);
    if (!encoded.includes('Reply with exactly READY. No other text.') || !encoded.includes('"READY"')) {
      throw new Error('Hosted runtime has not retained the expected test conversation');
    }
    const account = await request('/v1/account');
    if (!(account.usage?.requests > 0)) throw new Error('No hosted provider usage recorded today');
    console.log('PASS: Fly retained the desktop test prompt and READY reply; provider usage is recorded.');
  }
  console.log('PASS: private runtime discovery, authenticated health/agent list, and unauthorized rejection.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Runtime smoke failed; diagnostics suppressed');
  process.exitCode=1;
}

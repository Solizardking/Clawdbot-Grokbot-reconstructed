const mode=process.argv[2]??'--check';
if(!['--start','--check'].includes(mode))throw new Error('Use --start or --check');
async function request(path,body,method=body===undefined?'GET':'POST') {
  const response=await fetch('http://127.0.0.1:8799'+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Clawd HTTP ${response.status}`);return response.json();
}
let bot=(await request('/api/bots')).bots.find(b=>b.name==='Hosted tools check');
if(!bot)throw new Error('Verification bot missing');
const runIndex=process.argv.indexOf('--run-id');
const runId=runIndex<0?'V3':process.argv[runIndex+1];
if(!/^[A-Za-z0-9_-]{1,64}$/.test(runId??''))throw new Error('Invalid verification run ID');
const text=`CLAWD_MARKET_CHECK_${runId}: Call market_snapshot for network solana, address wrapped-sol, range 24h. Then reply in two sentences with the returned USD price, retrieval time, and source URL. Do not call SOLgpt or Birdeye.`;
if(mode==='--start'&&!bot.messages?.some(m=>m.role==='user'&&m.text===text)){
  if(bot.busy)throw new Error('Verification bot is busy');
  await request('/api/bots/'+bot.id,{modelSelection:{instanceId:'openaiCompat',model:'openrouter/free'}},'PATCH');
  await request('/api/bots/'+bot.id+'/messages',{text});
}
bot=(await request('/api/bots')).bots.find(b=>b.id===bot.id);
const index=bot.messages.findLastIndex(m=>m.role==='user'&&m.text===text);
console.log(JSON.stringify({busy:bot.busy,messages:index<0?[]:bot.messages.slice(index).map(m=>({role:m.role,text:m.research?undefined:m.text,tool:m.tool,research:m.research?{kind:m.research.kind,candles:m.research.candles?.length,source:m.research.source,retrievedAt:m.research.retrievedAt}:undefined}))}));

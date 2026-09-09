const mode=process.argv[2]??'--check';
if(!['--start','--check'].includes(mode))throw new Error('Use --start once, then --check');
async function call(path,body){const response=await fetch('http://127.0.0.1:8799'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`Clawd request failed (HTTP ${response.status})`);return response.json();}
const name='Hosted tools check';
let bots=(await call('/api/bots')).bots;
let bot=bots.find(bot=>bot.name===name);
if(!bot && mode==='--start') {
  bot=(await call('/api/bots',{})).bot;
  const response=await fetch(`http://127.0.0.1:8799/api/bots/${bot.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name,modelSelection:{instanceId:'openaiCompat',model:'nvidia/nemotron-3.5-lightning:free'}})});
  if(!response.ok)throw new Error('Cannot configure verification bot');
  bot=(await response.json()).bot;
}
if(!bot)throw new Error('Verification bot has not been created');
const prompt='Use tavily_search once for "official Solana documentation" with max_results 1. Reply with one source URL from the actual tool result and TAVILY_FLY_READY_V2.';
if(mode==='--start'&&!bot.messages?.some(message=>message.role==='user'&&message.text===prompt)) {
  if(bot.busy)throw new Error('Verification bot is busy; check its existing turn');
  await call(`/api/bots/${bot.id}/messages`,{text:prompt});
}
bots=(await call('/api/bots')).bots;bot=bots.find(row=>row.id===bot.id);
console.log(JSON.stringify({id:bot.id,threadId:bot.threadId,name:bot.name,busy:bot.busy,model:bot.modelSelection,
  messages:(bot.messages??[]).map(message=>({role:message.role,kind:message.kind,text:message.text,title:message.title,tool:message.tool,status:message.status})),
}));

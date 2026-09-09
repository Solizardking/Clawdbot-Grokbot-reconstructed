const mode=process.argv[2]??'--check';
if(!['--start','--check'].includes(mode))throw new Error('Use --start or --check');
async function request(path,body,method=body===undefined?'GET':'POST') {
 const r=await fetch('http://127.0.0.1:8799'+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error(`Clawd HTTP ${r.status}`);return r.json();
}
let bot=(await request('/api/bots')).bots.find(b=>b.name==='Hosted tools check');
if(!bot)throw new Error('Verification bot missing');
const text='Reply with only NOVITA_CHAT_READY_V2.';
if(mode==='--start'&&!bot.messages?.some(m=>m.role==='user'&&m.text===text)){
 if(bot.busy)throw new Error('Verification bot is still busy');
 await request('/api/bots/'+bot.id,{modelSelection:{instanceId:'hosted-novita',model:'solanaclawd/solana-nvidia-trading-factory-8b:de-b5d83f18d9145215'}},'PATCH');
 await request('/api/bots/'+bot.id+'/messages',{text});
}
bot=(await request('/api/bots')).bots.find(b=>b.id===bot.id);
const i=bot.messages.findLastIndex(m=>m.role==='user'&&m.text===text);
console.log(JSON.stringify({busy:bot.busy,model:bot.modelSelection,messages:i<0?[]:bot.messages.slice(i).map(m=>({role:m.role,text:m.text,tool:m.tool}))}));

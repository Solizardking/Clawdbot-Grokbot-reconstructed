import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createGateway } from '../services/provider-gateway/server.mjs';
import { browserUseResponse } from '../services/provider-gateway/browser-use.mjs';
import { e2bRequest, executeDesktop } from '../services/provider-gateway/e2b.mjs';
import { createGatewayStore } from '../services/provider-gateway/store.mjs';
import { mediaResponse } from '../services/provider-gateway/media.mjs';
import { transform } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const token = 'a'.repeat(43);
const otherToken = 'b'.repeat(43);
const digest = t => createHash('sha256').update(t).digest('hex');
test('existing desktop storage migrates without reassigning a running legacy session',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'clawd-desktop-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'state.sqlite'),old=new DatabaseSync(file);
  old.exec("CREATE TABLE desktops (user_id TEXT PRIMARY KEY, sandbox_id TEXT, expires_at INTEGER NOT NULL); INSERT INTO desktops VALUES ('alice','legacy-desktop',900000)");old.close();
  const store=createGatewayStore(file);
  try {
    assert.deepEqual({...store.desktop('alice')},{id:'legacy-desktop',expiresAt:900000,contextId:''});
    assert.equal(store.reserveDesktop('alice',1000,901000,'new-bot'),false);
    assert.equal(store.desktop('alice').id,'legacy-desktop');
    store.clearDesktop('alice','legacy-desktop');
    assert.equal(store.reserveDesktop('alice',1000,901000,'new-bot'),true);
    assert.equal(store.desktop('alice').contextId,'new-bot');
  }finally{store.close();}
});
test('Solana Tracker requires its grant, keeps credentials private and rejects writes and overrides', async t => {
  const config = {...env, SOLANA_TRACKER_SECURE_RPC: 'https://test.secure.rpc.solanatracker.io', GATEWAY_USERS_JSON:JSON.stringify({
    [digest(token)]:{id:'alice',models:['allowed'],services:['solana'],dailyRequests:2},
    [digest(otherToken)]:{id:'bob',models:['allowed'],services:['helius']},
  })};
  let calls=0;
  const send=await fixture(t,async(url,init)=>{
    calls++;
    assert.equal(url,'https://test.secure.rpc.solanatracker.io/');
    assert.deepEqual(init.headers,{'content-type':'application/json'});
    assert.equal(init.redirect,'error');
    assert.deepEqual(Object.keys(JSON.parse(init.body)),['jsonrpc','id','method','params']);
    return Response.json(calls===1?{result:{context:{slot:12},value:50}}:{error:{message:'secret upstream URL'}});
  },{env:config});
  const rpc={jsonrpc:'2.0',id:1,method:'getBalance',params:['11111111111111111111111111111111']};
  assert.equal((await send(rpc,'invalid','/solana/rpc')).status,401);
  assert.equal((await send(rpc,otherToken,'/solana/rpc')).status,403);
  for(const body of [[rpc],{...rpc,method:'sendTransaction'},{...rpc,method:'getAssetsByOwner'},{...rpc,params:{url:'https://other'}}])
    assert.equal((await send(body,token,'/solana/rpc')).status,400);
  assert.equal(calls,0);
  const success=await send({...rpc,url:'https://other',apiKey:'override'},token,'/solana/rpc');
  assert.deepEqual(await success.json(),{jsonrpc:'2.0',id:1,result:{context:{slot:12},value:50}});
  assert.doesNotMatch(await (await send(rpc,token,'/solana/rpc')).text(),/secret upstream/);
  assert.equal((await send(rpc,token,'/solana/rpc')).status,429);
  assert.equal(calls,2);
  const {solanaTrackerEndpoint}=await import('../services/provider-gateway/solana-tracker.mjs');
  for(const url of ['http://rpc-mainnet.solanatracker.io/','https://localhost/','https://rpc-mainnet.solanatracker.io.evil.test/','https://user:pass@rpc-mainnet.solanatracker.io/'])
    assert.equal(solanaTrackerEndpoint({SOLANA_TRACKER_RPC_URL:url}),null);
  assert.equal(solanaTrackerEndpoint({SOLANA_TRACKER_RPC_URL:'https://rpc-mainnet.solanatracker.io/?api_key=private'}),'https://rpc-mainnet.solanatracker.io/?api_key=private');
});
test('media requires grants and models, bounds requests, and preserves private binary results', async t => {
  const config = {...env,GATEWAY_USERS_JSON:JSON.stringify({
    [digest(token)]:{id:'alice',models:['image','tts','stt'],services:['media']},
    [digest(otherToken)]:{id:'bob',models:['tts']},
  })};
  let calls=0;
  const send=await fixture(t,async(url,init)=>{
    calls++;
    assert.equal(init.headers.authorization,'Bearer '+env.OPENROUTER_API_KEY);
    assert.equal(init.redirect,'error');
    const body=JSON.parse(init.body);
    if(url.endsWith('/images')) { assert.equal(body.n,1); return new Response(JSON.stringify({data:[{b64_json:'aW1hZ2U=',media_type:'image/png'}],privateField:'not forwarded'})); }
    if(url.endsWith('/audio/speech')) return new Response(Buffer.from('audio'),{headers:{'content-type':'audio/mpeg'}});
    return new Response(JSON.stringify({text:'hello',privateField:'not forwarded'}));
  },{env:config});
  const speech={model:'tts',input:'hello',response_format:'mp3'};
  assert.equal((await send(speech,otherToken,'/openrouter/v1/audio/speech')).status,403);
  for(const body of [{...speech,model:'expensive'},{...speech,input:'a'.repeat(4097)},{...speech,provider:{api_key:'override'}}]) assert.equal((await send(body,token,'/openrouter/v1/audio/speech')).status,400);
  assert.equal(calls,0);
  const audio=await send(speech,token,'/openrouter/v1/audio/speech');
  assert.equal(audio.headers.get('content-type'),'audio/mpeg');
  assert.equal(await audio.text(),'audio');
  const image=await send({model:'image',prompt:'blue square'},token,'/openrouter/v1/images');
  assert.deepEqual(await image.json(),{data:[{b64_json:'aW1hZ2U=',media_type:'image/png'}]});
  const transcript=await send({model:'stt',input_audio:{data:'YXVkaW8=',format:'mp3'}},token,'/openrouter/v1/audio/transcriptions');
  assert.deepEqual(await transcript.json(),{text:'hello'});
  assert.equal((await send({model:'stt',input_audio:{data:'https://private',format:'mp3'}},token,'/openrouter/v1/audio/transcriptions')).status,400);
  await assert.rejects(mediaResponse(new Response('{"error":"private key"}',{headers:{'content-type':'application/json'}}),'/audio/speech'),/Invalid speech/);
  await assert.rejects(mediaResponse(new Response(new Uint8Array(24000001),{headers:{'content-type':'audio/mpeg'}}),'/audio/speech'),/too large/);
});
test('desktop actions reconnect only the owned sandbox without extending its lifetime', async () => {
  const store = createGatewayStore(':memory:');
  let time = 1000000;
  const user = { id: 'alice' }, calls = [];
  const sandbox = {
    sandboxId: 'desktop-a',
    screenshot: async () => Buffer.from('png'),
    leftClick: async (...args) => calls.push(args),
    commands: { run: async (command, options) => {
      assert.equal(options.timeoutMs,30000);
      if (command === 'false') throw Object.assign(new Error('internal message not returned'), {name:'CommandExitError',exitCode:1,stdout:'',stderr:'user command failed'});
      return { stdout: command, exitCode: 0 };
    } },
  };
  const sdk = {
    create: async () => sandbox,
    connect: async (id, options) => { assert.equal(id,'desktop-a'); assert.equal(options.timeoutMs,100000); return sandbox; },
    kill: async () => { throw new Error('provider unavailable'); },
  };
  const execute = (action,args = {}) => executeDesktop(e2bRequest({action,args}),user,store,{apiKey:'private',now:()=>time,sdk});
  try {
    await execute('status');
    time += 800000;
    assert.equal((await execute('screenshot')).image_base64,Buffer.from('png').toString('base64'));
    await execute('click',{x:5,y:7});
    assert.deepEqual(calls,[[5,7]]);
    assert.equal((await execute('run_command',{command:'echo ok'})).stdout,'echo ok');
    assert.deepEqual(await execute('run_command',{command:'false'}),{exitCode:1,stdout:'',stderr:'user command failed'});
    await assert.rejects(execute('stop'),/provider unavailable/);
    assert.equal(store.desktop('alice').id,'desktop-a');
    for (const body of [{action:'click',args:{x:-1,y:0}}, {action:'run_command',args:{command:'ok',envs:{KEY:'secret'}}}, {action:'status',args:{sandboxId:'foreign'}}]) assert.throws(()=>e2bRequest(body));
  } finally { store.close(); }
});
test('desktop inspection never creates a sandbox and active sessions cannot cross bot contexts', async () => {
  const store=createGatewayStore(':memory:');let time=1000,creates=0,kills=0;
  const sdk={create:async()=>{creates++;return {sandboxId:'context-desktop',kill:async()=>{}};},kill:async()=>{kills++;},connect:async()=>{throw new Error('wrong context must not connect');}};
  const request=(action,contextId)=>executeDesktop(e2bRequest({action,contextId}),{id:'alice'},store,{apiKey:'private',now:()=>time,sdk});
  try {
    assert.equal((await request('inspect','bot-a')).state,'stopped');assert.equal(creates,0);
    await request('status','bot-a');assert.equal(creates,1);
    assert.equal((await request('inspect','bot-a')).state,'ready');
    assert.deepEqual(await request('inspect','bot-b'),{state:'in_use',expiresAt:901000,resolution:[1280,800]});
    for(const action of ['status','screenshot','stop'])await assert.rejects(request(action,'bot-b'),/another bot/);
    await assert.rejects(request('stop',undefined),/another bot/);assert.equal(kills,0);
    await request('stop','bot-a');assert.equal(kills,1);
    await request('status','bot-b');assert.equal(creates,2);
    time=902000;assert.equal((await request('inspect','bot-b')).state,'stopped');assert.equal(creates,2);
    for(const contextId of ['',{},'a/b','x'.repeat(129)])assert.throws(()=>e2bRequest({action:'inspect',contextId}),/context/);
  }finally {store.close();}
});
test('hosted desktops isolate users, retain uncertain creates, and allow cleanup after daily quota', async t => {
  let creates = 0, kills = 0;
  const desktopSdk = {
    async create(options) {
      assert.deepEqual(options.envs, {});
      assert.equal(options.timeoutMs, 900000);
      assert.equal(options.secure, true);
      creates++;
      if (creates === 2) throw new Error('unknown provider outcome containing a private key');
      return { sandboxId: 'alice-desktop', kill: async () => {} };
    },
    async kill(id) { assert.equal(id, 'alice-desktop'); kills++; },
    async connect() { throw new Error('must not connect'); },
  };
  const config = { ...env, E2B_API_KEY: 'private-e2b-key', GATEWAY_USERS_JSON: JSON.stringify({
    [digest(token)]: { id: 'alice', models: ['allowed'], services: ['e2b'], dailyRequests: 1 },
    [digest(otherToken)]: { id: 'bob', models: ['allowed'], services: ['e2b'] },
  }) };
  const send = await fixture(t, () => { throw new Error('no HTTP proxy'); }, { env: config, desktopSdk });
  const request = (action, who = token, args = {}) => send({ action, args }, who, '/e2b/request');
  assert.equal((await request('stop')).status, 200);
  assert.equal(creates, 0);
  assert.equal((await request('status')).status, 200);
  assert.equal((await request('screenshot', otherToken)).status, 409);
  assert.equal((await request('stop', otherToken)).status, 200);
  assert.equal(kills, 0);
  assert.equal((await request('status', token, { sandboxId: 'foreign' })).status, 400);
  assert.equal((await request('status')).status, 429);
  assert.equal((await request('stop')).status, 200);
  assert.equal(kills, 1);
  const failed = await request('status', otherToken);
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /private key|unknown provider/);
  assert.equal((await request('status', otherToken)).status, 409);
  assert.equal(creates, 2);
});
test('terminal browser failures preserve lifecycle without exposing raw provider errors', async () => {
  const result = await browserUseResponse(new Response(JSON.stringify({ id: 'run-a', status: 'failed', error: 'private-provider-key', sessionId: 'session-a' })),
    { kind: 'run', id: 'run-a' }, { id: 'alice' }, { claim() {} });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Browser task failed');
  assert.doesNotMatch(JSON.stringify(result), /private-provider-key/);
});
const env = {
  GATEWAY_DATABASE_PATH: ':memory:',
  OPENROUTER_API_KEY: 'operator-secret-must-stay-upstream',
  GATEWAY_USERS_JSON: JSON.stringify({
    [digest(token)]: { id: 'alice', models: ['allowed'] },
    [digest(otherToken)]: { id: 'bob', models: ['allowed'] },
  }),
};
test('compatible model catalogs are authenticated, provider-specific and limited to existing grants', async t => {
  const policy = {...env,GATEWAY_USERS_JSON:JSON.stringify({
    [digest(token)]:{id:'alice',models:['chat-a','media-a','xai-chat'],chatModels:{openrouter:['chat-a'],xai:['xai-chat']}},
    [digest(otherToken)]:{id:'bob',models:['chat-b'],chatModels:{openrouter:['chat-b']}},
  })};
  const server=createGateway({env:policy,fetchImpl:()=>{throw new Error('catalog must not contact providers');}});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const read=(auth,provider='openrouter')=>fetch(`http://127.0.0.1:${server.address().port}/${provider}/v1/models`,{headers:{authorization:`Bearer ${auth}`}});
  assert.equal((await read('invalid')).status,401);
  assert.deepEqual((await (await read(token)).json()).data.map(model=>model.id),['chat-a']);
  assert.deepEqual((await (await read(otherToken)).json()).data.map(model=>model.id),['chat-b']);
  assert.deepEqual((await (await read(token,'xai')).json()).data,[]);
  for(const chatModels of [{openrouter:['not-granted']},{foreign:['chat-a']},{openrouter:'chat-a'}]) {
    assert.throws(()=>createGateway({env:{...env,GATEWAY_USERS_JSON:JSON.stringify({[digest(token)]:{id:'alice',models:['chat-a'],chatModels}})}}),/Invalid gateway chat model catalog/);
  }
});
async function fixture(t, fetchImpl, options = {}) {
  const server = createGateway({ env, fetchImpl, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return (body = { model: 'allowed', messages: [{ role: 'user', content: 'hello' }] }, auth = token, path = '/openrouter/v1/chat/completions') => fetch(origin + path, {
    method: 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
test('NVIDIA requires a provider grant, keeps its key upstream and supports bounded streamed chat', async t => {
  const model = 'nvidia/nemotron-3-super-120b-a12b';
  const config = {...env, NVIDIA_API_KEY:'private-nvidia', GATEWAY_USERS_JSON:JSON.stringify({
    [digest(token)]:{id:'alice',models:[model,'other'],chatModels:{nvidia:[model],openrouter:['other']}},
    [digest(otherToken)]:{id:'bob',models:[model]},
  })};
  let calls=0;
  const send=await fixture(t,async(url,init)=>{
    calls++;
    assert.equal(url,'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.equal(init.headers.authorization,'Bearer private-nvidia');
    assert.equal(init.redirect,'error');
    const body=JSON.parse(init.body);
    assert.equal(body.max_tokens,512);
    assert.equal(body.api_key,undefined);
    assert.equal(body.reasoning,undefined);
    assert.deepEqual(body.chat_template_kwargs,calls===1?{enable_thinking:false}:{enable_thinking:true,low_effort:true,reasoning_budget:128});
    return new Response('data: {"choices":[{"delta":{"content":"NVIDIA_READY"}}]}\n\ndata: [DONE]\n\n');
  },{env:config});
  const body={model,messages:[{role:'user',content:'hello'}],max_tokens:512,stream:true,api_key:'override',chat_template_kwargs:{enable_thinking:true,endpoint:'https://foreign'}};
  const route='/nvidia/v1/chat/completions';
  assert.equal((await send(body,'invalid',route)).status,401);
  assert.equal((await send(body,otherToken,route)).status,403);
  assert.equal((await send({...body,model:'other'},token,route)).status,403);
  assert.equal((await send(body,token,'/openrouter/v1/chat/completions')).status,403);
  assert.equal((await send({...body,reasoning:{effort:'max'}},token,route)).status,400);
  assert.equal(calls,0);
  const reply=await send(body,token,route);
  assert.equal(reply.status,200);
  assert.equal(reply.headers.get('content-type'),'text/event-stream');
  const text=await reply.text();assert.match(text,/NVIDIA_READY/);assert.match(text,/\[DONE\]/);assert.doesNotMatch(text,/private-nvidia/);
  assert.equal((await send({...body,reasoning:{enabled:true,effort:'low',max_tokens:128}},token,route)).status,200);
  assert.equal(calls,2);
});
test('market enrichment spends the Birdeye credential only for a separately granted user', async t => {
  const mint='So11111111111111111111111111111111111111112';let birdeyeCalls=0;
  const send=await fixture(t,async(url,init)=>{
    if(url.startsWith('https://public-api.birdeye.so/')) {birdeyeCalls++;assert.equal(init.headers['X-API-KEY'],'private-birdeye');return Response.json({success:true,data:{[mint]:{address:mint,price:100,holder:25}}});}
    return Response.json({pairs:[{chainId:'solana',baseToken:{address:mint,name:'Wrapped SOL',symbol:'SOL'},priceUsd:'100',liquidity:{usd:500}}]});
  },{env:{...env,BIRDEYE_API_KEY:'private-birdeye',GATEWAY_USERS_JSON:JSON.stringify({
    [digest(token)]:{id:'alice',models:['allowed'],services:['market','birdeye']},
    [digest(otherToken)]:{id:'bob',models:['allowed'],services:['market']},
  })}});
  const body={action:'search',query:'SOL'};
  const basic=await (await send(body,otherToken,'/market/request')).json();assert.equal(basic.tokens[0].birdeye,undefined);assert.equal(birdeyeCalls,0);
  const enriched=await (await send(body,token,'/market/request')).json();assert.equal(enriched.tokens[0].birdeye.holders,25);assert.equal(birdeyeCalls,1);
  assert.equal((await send({action:'market_data',mints:[mint]},otherToken,'/birdeye/request')).status,403);
  assert.ok(!JSON.stringify(enriched).includes('private-birdeye'));
});
test('Novita uses its fixed dedicated endpoint and reasoning metadata survives within token limits', async t => {
  const details=[{type:'reasoning.encrypted',data:'opaque-state',index:0}];
  let calls=0;
  const send=await fixture(t,async(url,init)=>{
    calls++;
    assert.equal(url,'https://api.novita.ai/dedicated/v1/openai/chat/completions');
    assert.equal(init.headers.authorization,'Bearer private-novita');
    const body=JSON.parse(init.body);
    assert.deepEqual(body.messages[0].reasoning_details,details);
    assert.deepEqual(body.reasoning,{enabled:true,max_tokens:128});
    assert.deepEqual(body.stream_options,{include_usage:true});
    assert.equal(body.max_tokens,256);
    assert.equal(body.api_key,undefined);
    return new Response('data: {"choices":[{"delta":{"content":"READY","reasoning_details":[{"type":"reasoning.encrypted","data":"opaque-next"}]}}]}\n\ndata: [DONE]\n\n');
  },{env:{...env,NOVITA_API_KEY:'private-novita'}});
  const body={model:'allowed',messages:[{role:'assistant',content:'prior',reasoning_details:details},{role:'user',content:'next'}],reasoning:{enabled:true,max_tokens:128},max_tokens:256,stream:true,stream_options:{include_usage:true},api_key:'override'};
  const reply=await send(body,token,'/novita/v1/chat/completions');
  assert.equal(reply.status,200); assert.match(await reply.text(),/opaque-next/);
  for(const reasoning of [{max_tokens:256},{enabled:'true'},{endpoint:'https://elsewhere'},{effort:'unbounded'}]) assert.equal((await send({...body,reasoning},token,'/novita/v1/chat/completions')).status,400);
  assert.equal(calls,1);
});
test('hosted Tavily MCP isolates grants, bounds web operations and keeps provider credentials upstream', async t => {
  let calls=0;
  const config={...env,TAVILY_API_KEY:'private-tavily',GATEWAY_USERS_JSON:JSON.stringify({
    [digest(token)]:{id:'alice',models:['allowed'],services:['tavily'],dailyRequests:1},
    [digest(otherToken)]:{id:'bob',models:['allowed']},
  })};
  const send=await fixture(t,async(url,init)=>{
    calls++;assert.equal(url,'https://api.tavily.com/search');
    assert.equal(init.headers.authorization,'Bearer private-tavily');
    assert.equal(init.redirect,'error');
    assert.deepEqual(JSON.parse(init.body),{query:'Solana documentation',max_results:3,search_depth:'basic',include_answer:false,include_raw_content:false});
    return new Response(JSON.stringify({results:[{url:'https://solana.com/docs',title:'Solana',content:'Docs',privateField:'omit'}],privateField:'omit'}));
  },{env:config});
  const call=(method,params,auth=token)=>send({jsonrpc:'2.0',id:1,method,params},auth,'/tavily/mcp');
  assert.equal((await call('tools/list',{},otherToken)).status,403);
  assert.equal((await call('initialize',{})).status,200);
  assert.equal((await (await call('tools/list',{})).json()).result.tools.length,2);
  for(const args of [{query:'x',api_key:'override'},{query:'x',max_results:20}]) assert.equal((await call('tools/call',{name:'tavily_search',arguments:args})).status,400);
  assert.equal((await call('tools/call',{name:'tavily_extract',arguments:{urls:['http://127.0.0.1/private']}})).status,400);
  assert.equal(calls,0);
  const result=await (await call('tools/call',{name:'tavily_search',arguments:{query:'Solana documentation'}})).json();
  assert.equal(result.result.isError,false);assert.match(result.result.content[0].text,/solana.com/);assert.doesNotMatch(JSON.stringify(result),/privateField|private-tavily/);
  assert.equal((await call('tools/call',{name:'tavily_search',arguments:{query:'Solana documentation'}})).status,429);
  assert.equal((await call('tools/list',{})).status,200);
  assert.equal(calls,1);
});
test('daily quota rejects excess requests before upstream; failed storage fails closed', async t => {
  let calls = 0;
  const policy = { ...env, GATEWAY_USERS_JSON: JSON.stringify({ [digest(token)]: { id: 'alice', models: ['allowed'], dailyRequests: 1 } }) };
  const send = await fixture(t, async () => { calls++; return new Response('{}'); }, { env: policy });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 429);
  assert.equal(calls, 1);
  const broken = await fixture(t, async () => { calls++; }, { store: { reserve() { throw new Error('disk failure'); } } });
  assert.equal((await broken()).status, 503);
  assert.equal(calls, 1);
});
test('account endpoint only exposes the authenticated user and never the registry or keys', async t => {
  const server = createGateway({ env });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/v1/account`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.json();
  assert.equal(payload.id, 'alice');
  assert.equal(payload.dailyRequests, 200);
  assert.equal(payload.usage.requests, 0);
  assert.doesNotMatch(JSON.stringify(payload), /bob|operator-secret/);
  assert.equal((await fetch(url + '?user=bob', { headers: { authorization: `Bearer ${token}` } })).status, 404);
});
test('gateway refuses missing configuration and invalid policies', () => {
  assert.throws(() => createGateway({ env: {} }));
  assert.throws(() => createGateway({ env: { ...env, GATEWAY_USERS_JSON: '{"plaintext-token":{}}' } }));
});
test('hosted Browser Use binds runs and sessions to users and blocks foreign access before upstream', async t => {
  const browserEnv = { ...env, BROWSER_USE_API_KEY: 'private-browser-key', GATEWAY_USERS_JSON: JSON.stringify({
    [digest(token)]: { id: 'alice', models: ['allowed'], services: ['browseruse'] },
    [digest(otherToken)]: { id: 'bob', models: ['allowed'], services: ['browseruse'] },
  }) };
  const calls = [];
  const send = await fixture(t, async (url, init) => {
    calls.push({ url, ...init });
    assert.equal(init.headers['x-browser-use-api-key'], 'private-browser-key');
    if (init.method === 'POST' && url.endsWith('/runs')) {
      assert.deepEqual(JSON.parse(init.body), { task: 'read example.com', model: 'gpt-5.6-luna', maxCostUsd: 1, agentmail: false });
      return new Response(JSON.stringify({ id: 'run-a', sessionId: 'session-a', workspaceId: 'workspace-a', status: 'running' }));
    }
    if (url.endsWith('/sessions/session-a')) return new Response(JSON.stringify({ sessionId: 'session-a', latestRunId: 'run-b' }));
    if (url.endsWith('/sessions/session-a/queue')) return new Response(JSON.stringify({ sessionId: 'session-a', runId: null }));
    if (init.method === 'GET') return new Response(JSON.stringify({ id: 'run-a', result: 'Private Alice result', sessionId: 'session-a' }));
    if (url.endsWith('/browsers')) return new Response(JSON.stringify({ id: 'browser-a', cdpUrl: 'wss://private.example' }));
    return new Response('{"ok":true}');
  }, { env: browserEnv });
  const request = (body, auth = token) => send(body, auth, '/browseruse/request');
  assert.equal((await request({ method: 'POST', path: '/runs', body: { task: 'read example.com', profileId: 'foreign', workspaceId: 'foreign', secretBindings: ['foreign'] } })).status, 200);
  assert.equal((await request({ method: 'GET', path: '/runs/run-a' }, otherToken)).status, 404);
  assert.equal((await request({ method: 'POST', path: '/sessions/session-a/queue', body: { text: 'steal' } }, otherToken)).status, 404);
  assert.equal((await request({ method: 'GET', path: '/runs' })).status, 400);
  assert.equal(calls.length, 1);
  assert.match(await (await request({ method: 'GET', path: '/runs/run-a' })).text(), /Private Alice/);
  assert.equal((await request({ method: 'POST', path: '/sessions/session-a/queue', body: { text: 'continue' } })).status, 200);
  assert.equal((await request({ method: 'GET', path: '/sessions/session-a' }, otherToken)).status, 404);
  assert.equal((await request({ method: 'GET', path: '/sessions/session-a' })).status, 200);
  assert.equal((await request({ method: 'POST', path: '/runs/run-b/cancel' }, otherToken)).status, 404);
  assert.equal((await request({ method: 'POST', path: '/runs/run-b/cancel' })).status, 200);
  assert.equal((await request({ method: 'POST', path: '/browsers', body: { profileId: 'foreign' } })).status, 200);
  assert.equal((await request({ method: 'PATCH', path: '/browsers/browser-a', body: { action: 'stop' } }, otherToken)).status, 404);
  assert.equal((await request({ method: 'PATCH', path: '/browsers/browser-a', body: { action: 'stop' } })).status, 200);
});
test('Helius requires a user grant, rejects writes and batches, and conceals operator credentials', async t => {
  let calls = 0;
  const rpcEnv = { ...env, HELIUS_API_KEY: 'private-helius-key', GATEWAY_USERS_JSON: JSON.stringify({
    [digest(token)]: { id: 'alice', models: ['allowed'], services: ['helius'] },
    [digest(otherToken)]: { id: 'bob', models: ['allowed'] },
  }) };
  const rpc = { jsonrpc: '2.0', id: 'lookup', method: 'getBalance', params: ['public-wallet'] };
  const send = await fixture(t, async (url, init) => {
    calls++;
    assert.equal(url, 'https://mainnet.helius-rpc.com/?api-key=private-helius-key');
    assert.equal(init.headers.authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), rpc);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'wrong-id', result: { value: 42 } }));
  }, { env: rpcEnv });
  assert.equal((await send(rpc, otherToken, '/helius/rpc')).status, 403);
  assert.equal((await send({ ...rpc, method: 'sendTransaction' }, token, '/helius/rpc')).status, 400);
  assert.equal((await send([rpc], token, '/helius/rpc')).status, 400);
  assert.equal(calls, 0);
  const success = await send({ ...rpc, url: 'https://evil.test', apiKey: 'ignored' }, token, '/helius/rpc');
  assert.deepEqual(await success.json(), { jsonrpc: '2.0', id: 'lookup', result: { value: 42 } });
  assert.equal(calls, 1);
  const errorSend = await fixture(t, async () => new Response(JSON.stringify({ error: { message: 'secret=private-helius-key' } })), { env: rpcEnv });
  const error = await errorSend(rpc, token, '/helius/rpc');
  assert.doesNotMatch(await error.text(), /private-helius/);
});
test('authentication, model policy, and fixed routes block unauthorized upstream calls', async t => {
  const send = await fixture(t, () => { throw new Error('must not call upstream'); });
  assert.equal((await send(undefined, 'invalid')).status, 401);
  assert.equal((await send({ model: 'expensive', messages: [{}] })).status, 400);
  assert.equal((await send(undefined, token, '/openrouter/v1/chat/completions?url=https://evil.test')).status, 404);
  assert.equal((await send(undefined, token, '/xai/v1/chat/completions')).status, 503);
  assert.equal((await send({ model: 'allowed', messages: [{}], max_tokens: -1 })).status, 400);
});
test('gateway replaces credentials, caps tokens, strips overrides and streams the response', async t => {
  let call;
  const send = await fixture(t, async (url, init) => {
    call = { url, ...init, body: JSON.parse(init.body) };
    return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n');
  });
  const response = await send({ model: 'allowed', messages: [{}], stream: true, max_tokens: 100_000, models: ['disallowed'], provider: { api_key: 'attacker' }, user: 'impersonation' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(await response.text(), /\[DONE\]/);
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.headers.authorization, `Bearer ${env.OPENROUTER_API_KEY}`);
  assert.equal(call.redirect, 'error');
  assert.equal(call.body.max_tokens, 4096);
  assert.equal(call.body.models, undefined);
  assert.equal(call.body.provider, undefined);
  assert.equal(call.body.user, undefined);
});
test('provider errors never echo credentials and rate limits are per user', async t => {
  let calls = 0;
  const send = await fixture(t, async () => { calls++; return new Response(env.OPENROUTER_API_KEY, { status: 401 }); });
  for (let i = 0; i < 20; i++) {
    const response = await send();
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /operator-secret/);
  }
  const limited = await send();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await send(undefined, otherToken)).status, 502);
  assert.equal(calls, 21);
});
test('oversized bodies never reach a provider', async t => {
  const send = await fixture(t, () => { throw new Error('must not call upstream'); });
  const response = await send({ model: 'allowed', messages: [{ content: 'x'.repeat(1_048_576) }] });
  assert.equal(response.status, 413);
});
test('desktop hosted route fails closed and sends only the user token to the gateway', async () => {
  const source = await readFile(new URL('../source/shared/hosted-provider.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const { hostedProviderConfig, createHostedProviderFetch } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  assert.equal(hostedProviderConfig({}), undefined);
  assert.throws(() => hostedProviderConfig({ SAND_HOSTED_GATEWAY_URL: 'https://gateway.test' }));
  assert.throws(() => hostedProviderConfig({ SAND_HOSTED_GATEWAY_URL: 'http://gateway.test', SAND_HOSTED_GATEWAY_TOKEN: token }));
  const config = hostedProviderConfig({ SAND_HOSTED_GATEWAY_URL: 'https://gateway.test', SAND_HOSTED_GATEWAY_TOKEN: token });
  let captured;
  const routed = createHostedProviderFetch(config, async (url, init) => { captured = { url, init }; return new Response('{}'); });
  await routed('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer operator-key', 'x-secret': 'no' }, body: '{}' });
  assert.equal(captured.url, 'https://gateway.test/xai/v1/chat/completions');
  assert.equal(captured.init.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(captured.init.headers.has('x-secret'), false);
  await assert.rejects(routed('https://evil.test', { method: 'POST', body: '{}' }));
});

test('Birdeye grants, fixed read routes, quotas and response projection protect provider access', async t => {
  const mint = 'So11111111111111111111111111111111111111112';
  const config = {...env, BIRDEYE_API_KEY:'private-market-key', GATEWAY_USERS_JSON:JSON.stringify({
    [digest(token)]:{id:'alice',models:['allowed'],services:['birdeye'],dailyRequests:2},
    [digest(otherToken)]:{id:'bob',models:['allowed']},
  })};
  let calls=0;
  const send=await fixture(t,async(url,init)=>{
    calls++;
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.body,undefined);
    assert.deepEqual(init.headers,{'X-API-KEY':'private-market-key','x-chain':'solana',accept:'application/json'});
    if(url.includes('multi_price')) {
      assert.equal(url,'https://public-api.birdeye.so/defi/multi_price?list_address='+mint);
      return Response.json({success:true,data:{[mint]:{value:123,priceChange24h:2,updateUnixTime:10,secret:'hidden'},foreign:{value:99}},private:'hidden'});
    }
    assert.equal(url,'https://public-api.birdeye.so/defi/token_overview?address='+mint);
    return Response.json({success:true,data:{name:'Solana',symbol:'SOL',price:123,secret:'hidden'}});
  },{env:config});
  const request={action:'price',mints:[mint]};
  assert.equal((await send(request,'invalid','/birdeye/request')).status,401);
  assert.equal((await send(request,otherToken,'/birdeye/request')).status,403);
  for(const invalid of [{...request,url:'https://evil.test'},{...request,apiKey:'override'},{action:'price',mints:[]},{action:'price',mints:Array(11).fill(mint)},{action:'overview',mint:'../../private'}]) assert.equal((await send(invalid,token,'/birdeye/request')).status,400);
  assert.equal(calls,0);
  const prices=await send(request,token,'/birdeye/request');
  assert.deepEqual(await prices.json(),{success:true,data:{[mint]:{value:123,priceChange24h:2,updateUnixTime:10}}});
  const overview=await send({action:'overview',mint},token,'/birdeye/request');
  const payload=await overview.json();
  assert.equal(payload.data.symbol,'SOL');
  assert.doesNotMatch(JSON.stringify(payload),/hidden|secret/);
  assert.equal((await send(request,token,'/birdeye/request')).status,429);
  const broken=await fixture(t,async()=>Response.json({success:false,message:'private-market-key'}),{env:config});
  const failure=await broken(request,token,'/birdeye/request');
  assert.equal(failure.status,502);
  assert.doesNotMatch(await failure.text(),/private-market-key/);
  const {birdeyeResponse}=await import('../services/provider-gateway/birdeye.mjs');
  await assert.rejects(birdeyeResponse(new Response('x'.repeat(1_048_577)),{action:'overview'}),/too large/);
});

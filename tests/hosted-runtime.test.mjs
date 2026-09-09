import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createHostedRuntimeConnector } from '../source/electron-main/box/hosted-runtime-connector.ts';
import { createGateway } from '../services/provider-gateway/server.mjs';
import { hostedProviderConfig, withHostedProviderConfig } from '../source/shared/hosted-provider.ts';

const token = 'a'.repeat(43), other = 'b'.repeat(43);
const hash = t => createHash('sha256').update(t).digest('hex');
const policy = {
  [hash(token)]: { id:'alice', models:['allowed'], runtimeApp:'alice-runtime' },
  [hash(other)]: { id:'bob', models:['allowed'] },
};
const env = { GATEWAY_DATABASE_PATH:':memory:', OPENROUTER_API_KEY:'private-operator-key', GATEWAY_USERS_JSON:JSON.stringify(policy) };

test('concurrent hosted conversations keep their own token without mutating process environment', async () => {
  const before = process.env.SAND_HOSTED_GATEWAY_TOKEN;
  await Promise.all([token,other].map(value => withHostedProviderConfig({url:'https://gateway.fly.dev',token:value},async()=>{
    await new Promise(resolve=>setTimeout(resolve,value === token ? 10 : 1));
    assert.equal(hostedProviderConfig({SAND_HOSTED_GATEWAY_URL:'https://stale.fly.dev',SAND_HOSTED_GATEWAY_TOKEN:'c'.repeat(43)}).token,value);
  })));
  assert.equal(hostedProviderConfig({}),undefined);
  assert.equal(process.env.SAND_HOSTED_GATEWAY_TOKEN,before);
  withHostedProviderConfig(undefined,()=>assert.equal(hostedProviderConfig({SAND_HOSTED_GATEWAY_URL:'https://stale.fly.dev',SAND_HOSTED_GATEWAY_TOKEN:token}),undefined));
});

test('runtime discovery exposes only the authenticated user assignment and rejects shared computers', async t => {
  const forwarded = [];
  const server = createGateway({env, fetchImpl:async(url,init)=>{
    forwarded.push({url,init});
    return Response.json({ok:true});
  }});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/v1/runtime`;
  assert.equal((await fetch(url)).status,401);
  const mine = await fetch(url,{headers:{authorization:`Bearer ${token}`}});
  assert.deepEqual(await mine.json(),{transport:'gateway'});
  assert.equal(mine.headers.get('cache-control'),'no-store');
  for (const path of ['/health','/events?channels=agents','/api/createAgent']) {
    const init = {method:path.startsWith('/api/')?'POST':'GET',headers:{authorization:`Bearer ${token}`},redirect:'manual'};
    const replay = await fetch(url.replace('/v1/runtime',path),init);
    assert.equal(replay.status,200);
    assert.equal(forwarded.at(-1).url,`http://alice-runtime.flycast${path}`);
    assert.equal(forwarded.at(-1).init.headers.authorization,`Bearer ${token}`);
    assert.equal(forwarded.at(-1).init.redirect,'error');
    assert.equal(replay.headers.get('fly-replay'),null);
    assert.equal(replay.headers.get('fly-replay-cache'),null);
    assert.equal((await fetch(url.replace('/v1/runtime',path),{...init,headers:{authorization:`Bearer ${other}`}})).status,404);
    assert.equal((await fetch(url.replace('/v1/runtime',path),{...init,headers:{}})).status,401);
  }
  const oversized = await fetch(url.replace('/v1/runtime','/api/uploadFile'),{method:'POST',headers:{authorization:`Bearer ${token}`},body:'x'.repeat(1000001)});
  assert.equal(oversized.status,413);
  assert.equal(oversized.headers.get('fly-replay'),null);
  assert.equal(forwarded.length,3);
  assert.equal((await fetch(url,{headers:{authorization:`Bearer ${other}`}})).status,404);
  for (const runtimeApp of ['http://alice-runtime.fly.dev','https://alice-runtime.fly.dev/path','https://attacker.test','https://user:pass@alice-runtime.fly.dev']) {
    assert.throws(() => createGateway({env:{...env,GATEWAY_USERS_JSON:JSON.stringify({[hash(token)]:{...policy[hash(token)],runtimeApp}})}}),/Invalid runtime app/);
  }
  assert.throws(() => createGateway({env:{...env,GATEWAY_USERS_JSON:JSON.stringify({...policy,[hash(other)]:{...policy[hash(other)],runtimeApp:policy[hash(token)].runtimeApp}})}}),/cannot be shared/);
});

test('hosted connector uses saved user access, avoids Cursor fallback and refuses untrusted runtime addresses', async () => {
  let remoteCalls=0;
  const remote = {connect:async()=>{remoteCalls++;return {baseUrl:'legacy'};}};
  const access = {url:'https://provider.fly.dev',token};
  const connector = createHostedRuntimeConnector(remote,async()=>access,async(url,init)=>{
    assert.equal(url,'https://provider.fly.dev/v1/runtime');
    assert.equal(init.headers.authorization,`Bearer ${token}`);
    assert.equal(init.redirect,'error');
    return Response.json({transport:'gateway',ignoredOperatorKey:'never-returned'});
  });
  assert.deepEqual(await connector.connect(),{baseUrl:access.url,token,headers:{authorization:`Bearer ${token}`}});
  assert.equal(await connector.issueInferenceCredential(),undefined);
  await assert.rejects(connector.recreate({preserveData:true}),/managed by your gateway operator/);
  for (const response of [new Response('',{status:404}),new Response('',{status:401}),Response.json({baseUrl:'https://untrusted.example'}),Response.json({baseUrl:'https://alice-runtime.fly.dev/?token=leak'})]) {
    await assert.rejects(createHostedRuntimeConnector(remote,async()=>access,async()=>response).connect());
  }
  assert.equal(remoteCalls,0);
  assert.deepEqual(await createHostedRuntimeConnector(remote,async()=>undefined).connect(),{baseUrl:'legacy'});
  assert.equal(remoteCalls,1);
});

test('private runtime relay preserves request bodies and SSE, aborts disconnects, and hides upstream errors', async t => {
  let upstreamSignal, cancelled=false;
  const server = createGateway({env,fetchImpl:async(url,init)=>{
    if (url.endsWith('/api/createAgent')) {
      assert.deepEqual(JSON.parse(init.body.toString()),{name:'test'});
      assert.equal(init.headers['x-forwarded-host'],undefined);
      return Response.json({id:'test'});
    }
    if (url.endsWith('/events')) {
      upstreamSignal=init.signal;
      return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: ready\n\n'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
    }
    return new Response('internal secret detail',{status:500});
  }});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={authorization:`Bearer ${token}`,'content-type':'application/json','x-forwarded-host':'attacker.test'};
  assert.deepEqual(await (await fetch(base+'/api/createAgent',{method:'POST',headers,body:JSON.stringify({name:'test'})})).json(),{id:'test'});
  const fail=await fetch(base+'/health',{headers});
  assert.equal(fail.status,500);
  assert.doesNotMatch(await fail.text(),/internal secret/);
  const client=new AbortController();
  const events=await fetch(base+'/events',{headers,signal:client.signal});
  assert.equal(events.headers.get('content-type'),'text/event-stream');
  const reader=events.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value),'data: ready\n\n');
  client.abort();
  for(let i=0;i<50 && !upstreamSignal.aborted;i++) await new Promise(r=>setTimeout(r,10));
  assert.equal(upstreamSignal.aborted,true);
  assert.equal(cancelled,true);
});

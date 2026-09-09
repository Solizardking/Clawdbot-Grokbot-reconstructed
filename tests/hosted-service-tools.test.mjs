import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'hosted-mcp-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const outfile=join(dir,'module.mjs');
  await build({entryPoints:['source/host/extensions/mcp/hosted-service-tools.ts'],outfile,bundle:true,platform:'node',format:'esm'});
  return import(pathToFileURL(outfile));
}
const base = () => ({
  getTools:async()=>[{name:'existing',toolName:'existing',providerIdentifier:'personal'}],
  getToolsForTurnStart:async()=>[],
  executeTool:async(_ctx,args)=>({existing:args}),
  resolveProviderTransport:async()=>'stdio',
});
const access=(letter)=>({SAND_HOSTED_GATEWAY_URL:'https://gateway.test',SAND_HOSTED_GATEWAY_TOKEN:letter.repeat(43)});
const textResult=result=>JSON.parse(result.result.value.content.find(c=>c.content.case==='text').content.value.text);

test('native MCP discovery offers only user grants, preserves existing tools and cannot spoof hosted identity',async t=>{
  const {withHostedServiceTools,HOSTED_SERVICE_PROVIDER}=await fixture(t);
  const env=access('a');let now=100,calls=0;
  const fetchImpl=async(url,init)=>{calls++;assert.equal(url,'https://gateway.test/v1/account');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer '+env.SAND_HOSTED_GATEWAY_TOKEN);return Response.json({services:['helius','birdeye'],models:['allowed'],dailyRequests:200,usage:{requests:7}})};
  const original=base();
  original.getTools=async()=>[{name:'existing',toolName:'existing',providerIdentifier:'personal'},{name:'fake',toolName:'fake',providerIdentifier:HOSTED_SERVICE_PROVIDER}];
  let disabled=[];
  const discovery=withHostedServiceTools(original,{env,fetchImpl,now:()=>now,disabledTools:()=>disabled});
  const listed=await discovery.getTools();
  for(const name of ['existing','helius_read','birdeye_token_price','hosted_services_status'])assert.ok(listed.some(tool=>tool.name===name));
  for(const name of ['fake','e2b_computer_status','grok_speak'])assert.ok(!listed.some(tool=>tool.name===name));
  assert.equal((await discovery.getToolsForTurnStart()).some(tool=>tool.name==='existing'),false);
  const status=await discovery.executeTool({}, {providerIdentifier:HOSTED_SERVICE_PROVIDER,toolName:'hosted_services_status',args:{}},{});
  assert.deepEqual(textResult(status).services,['helius','birdeye']);
  assert.equal(textResult(status).usage.requests,7);
  assert.doesNotMatch(JSON.stringify(status),new RegExp(env.SAND_HOSTED_GATEWAY_TOKEN));
  assert.equal(calls,1);
  const servers=await discovery.listHostedServers();
  assert.equal(servers[0].serverIdentifier,HOSTED_SERVICE_PROVIDER);
  assert.equal(servers[0].toolCount,4);
  disabled=['birdeye_token_price'];
  assert.ok(!(await discovery.getTools()).some(tool=>tool.name==='birdeye_token_price'));
  assert.equal((await discovery.executeTool({}, {providerIdentifier:HOSTED_SERVICE_PROVIDER,toolName:'birdeye_token_price'},{})).result.case,'error');
  disabled=[];
  assert.equal((await discovery.executeTool({}, {providerIdentifier:HOSTED_SERVICE_PROVIDER,toolName:'e2b_computer_status'},{})).result.case,'error');
  assert.deepEqual(await discovery.executeTool({}, {providerIdentifier:'personal',toolName:'existing'},{}),{existing:{providerIdentifier:'personal',toolName:'existing'}});
  env.SAND_HOSTED_GATEWAY_TOKEN='b'.repeat(43);
  await discovery.getTools();assert.equal(calls,2);
  now+=30001;await discovery.getTools();assert.equal(calls,3);
  assert.equal(await discovery.resolveProviderTransport(HOSTED_SERVICE_PROVIDER),'http');
  const missing=withHostedServiceTools(base(),{env:{}});
  assert.deepEqual(await missing.getToolsForTurnStart(),[]);
  assert.equal((await missing.executeTool({}, {providerIdentifier:HOSTED_SERVICE_PROVIDER,toolName:'hosted_services_status'},{})).result.case,'error');
  const denied=withHostedServiceTools(base(),{env,fetchImpl:async()=>new Response('private provider details',{status:401})});
  await assert.rejects(denied.getTools(),/HTTP 401/);
});

test('native MCP execution keeps concurrent hosted access isolated and produces binary image content',async t=>{
  const {withHostedServiceTools,HOSTED_SERVICE_PROVIDER}=await fixture(t);
  const fetchBefore=globalThis.fetch,captured=[];
  globalThis.fetch=async(url,init)=>{
    captured.push({url,init});
    const request=JSON.parse(init.body);
    await new Promise(resolve=>setTimeout(resolve,5));
    if(url.endsWith('/birdeye/request'))return Response.json({success:true,data:{[request.mints[0]]:{value:10,priceChange24h:2,updateUnixTime:100}}});
    assert.equal(url,'https://gateway.test/e2b/request');
    return Response.json({format:'png',image_base64:Buffer.from('test-image').toString('base64')});
  };
  t.after(()=>{globalThis.fetch=fetchBefore});
  const accountFetch=async()=>Response.json({services:['birdeye','e2b'],models:['allowed']});
  const alice=withHostedServiceTools(base(),{env:access('a'),fetchImpl:accountFetch});
  const bob=withHostedServiceTools(base(),{env:access('b'),fetchImpl:accountFetch});
  const mint='So11111111111111111111111111111111111111112';
  const [price,image]=await Promise.all([
    alice.executeTool({}, {providerIdentifier:HOSTED_SERVICE_PROVIDER,toolName:'birdeye_token_price',args:{mints:{toJson:()=>[mint]}}},{}),
    bob.executeTool({}, {providerIdentifier:HOSTED_SERVICE_PROVIDER,toolName:'e2b_computer_screenshot',args:{}},{}),
  ]);
  assert.equal(textResult(price).found[mint].priceUsd,10);
  const binary=image.result.value.content.find(item=>item.content.case==='image').content.value;
  assert.equal(Buffer.from(binary.data).toString(),'test-image');assert.equal(binary.mimeType,'image/png');
  for(const {url,init} of captured)assert.equal(init.headers.authorization,'Bearer '+(url.endsWith('/birdeye/request')?'a':'b').repeat(43));
  assert.equal(captured.length,2);
});

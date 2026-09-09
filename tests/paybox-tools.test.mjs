import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir=await mkdtemp(path.join(tmpdir(),'paybox-tests-'));
test.after(()=>rm(dir,{recursive:true,force:true}));
const out=path.join(dir,'paybox.mjs');
await build({entryPoints:['source/node-agent-coordinator/paybox-tools.ts'],bundle:true,format:'esm',platform:'node',outfile:out,logLevel:'silent',banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'}});
const {createPayboxTools,sanitizePayboxResult}=await import(pathToFileURL(out));
function fixture({sse=false,failCall=false}={}) {
 const calls=[]; let token='test-token';
 const api=createPayboxTools({locked:work=>work(),resolveCredentials:async()=>({token,signingKey:undefined}),fetchImpl:async(url,init)=>{
  assert.equal(String(url),'https://api.paybox.sh/mcp'); assert.equal(init.redirect,'error');
  const body=JSON.parse(init.body); calls.push(body);
  if(body.method==='notifications/initialized') return new Response(null,{status:202});
  let result;
  if(body.method==='initialize') result={protocolVersion:'2025-06-18',instructions:'Read credentials before spending.'};
  if(body.method==='tools/list') result=body.params.cursor ? {tools:[{name:'get_request',inputSchema:{type:'object',properties:{request_id:{type:'string'}},required:['request_id']}}]} : {tools:[{name:'use_service',inputSchema:{type:'object',properties:{mode:{enum:['probe']}}}},{name:'moonx_internal',inputSchema:{}}],nextCursor:'next'};
  if(body.method==='tools/call') { if(failCall) return new Response('',{status:503}); result={content:[{type:'text',text:JSON.stringify({status:'pending_approval',request_id:'request-1',approval_url:'https://app.paybox.sh/approve/1',refresh_token:'never-show'})}]}; }
  const payload={jsonrpc:'2.0',id:body.id,result};
  return new Response(sse ? `data: ${JSON.stringify({jsonrpc:'2.0',method:'notifications/progress'})}\n\ndata: ${JSON.stringify(payload)}\n\n`:JSON.stringify(payload),{headers:{'content-type':sse?'text/event-stream':'application/json','mcp-session-id':'session-test'}});
 }});
 return {api,calls,setToken:value=>{token=value;}};
}
test('discovery initializes once, follows pagination, preserves schemas and excludes internal signing tools',async()=>{
 const {api,calls}=fixture(); const listed=await api.list(); await api.list();
 assert.deepEqual(listed.map(t=>t.name),['paybox_status','paybox_use_service','paybox_get_request']);
 assert.deepEqual(listed[1].inputSchema.properties.mode.enum,['probe']);
 assert.equal(calls.filter(c=>c.method==='initialize').length,1);
 assert.equal(calls.filter(c=>c.method==='tools/list').length,2);
});
test('SSE correlation, unpaid probe and pending approval round-trip without false success or secret leakage',async()=>{
 const {api,calls}=fixture({sse:true});
 const result=await api.execute('paybox_use_service',{url:'https://example.com/paid',mode:'probe'});
 const text=JSON.parse(result.content[0].text);
 assert.equal(text.status,'pending_approval'); assert.equal(text.request_id,'request-1'); assert.equal(text.refresh_token,undefined);
 assert.deepEqual(calls.find(c=>c.method==='tools/call').params.arguments,{url:'https://example.com/paid',mode:'probe'});
 assert.equal(calls.filter(c=>c.method==='tools/call').length,1);
 await assert.rejects(api.execute('paybox_moonx_internal',{}),/not granted or advertised/);
});
test('payment failures are not retried and account changes discard tool caches',async()=>{
 const {api,calls,setToken}=fixture({failCall:true});
 await assert.rejects(api.execute('paybox_use_service',{}),/HTTP 503/);
 assert.equal(calls.filter(c=>c.method==='tools/call').length,1);
 setToken('different-account'); await api.list();
 assert.equal(calls.filter(c=>c.method==='initialize').length,2);
});
test('disconnected status is explicit and sanitization retains price/payment/resource outcomes',async()=>{
 const {api,calls,setToken}=fixture();setToken(undefined);
 assert.deepEqual((await api.list()).map(t=>t.name),['paybox_status']);
 assert.equal((await api.execute('paybox_status',{})).authenticated,false);
 assert.equal(calls.length,0);
 const safe=sanitizePayboxResult({plan:{x402:{amount_usd:0.01},txs:['private envelope']},output:{value:{payment:{status:'success'},resource:{ok:false}}},signingKey:'pbxk1.secret'});
 assert.equal(safe.plan.x402.amount_usd,0.01); assert.equal(safe.plan.txs,undefined);
 assert.equal(safe.output.value.payment.status,'success'); assert.equal(safe.output.value.resource.ok,false); assert.equal(safe.signingKey,undefined);
});

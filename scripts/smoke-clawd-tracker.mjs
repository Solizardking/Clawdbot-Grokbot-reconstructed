import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHostedAccessFile} from './lib/hosted-access-file.mjs';
const access=parseHostedAccessFile(await readFile(new URL('../.cache/gateway-owner/client.env',import.meta.url),'utf8'));
const call=(body,authenticated=true)=>fetch(access.url+'/solana/rpc',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{'content-type':'application/json',...(authenticated?{authorization:`Bearer ${access.token}`}:{})},body:JSON.stringify(body),
});
const rpc={jsonrpc:'2.0',id:'clawd-rpc-check',method:'getLatestBlockhash',params:[{commitment:'confirmed'}]};
assert.equal((await call(rpc,false)).status,401);
assert.equal((await call({...rpc,method:'sendTransaction',params:[]})).status,400);
const response=await call(rpc);assert.equal(response.status,200);
const data=await response.json();assert.equal(typeof data.result?.value?.blockhash,'string');
assert.ok(Number.isSafeInteger(data.result.context?.slot));
const balance=await call({...rpc,method:'getBalance',params:['So11111111111111111111111111111111111111112',{commitment:'confirmed'}]});
assert.equal(balance.status,200);assert.ok(Number.isSafeInteger((await balance.json()).result?.value));
console.log(JSON.stringify({authenticatedRpc:true,mainnetBlockhash:true,publicAccountBalance:true,anonymousDenied:true,broadcastDenied:true,slot:data.result.context.slot}));

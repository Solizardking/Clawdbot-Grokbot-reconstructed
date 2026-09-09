import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('Birdeye tool uses only current hosted access, projects market data, and never falls back after failure', async t => {
  const dir=await mkdtemp(join(tmpdir(),'birdeye-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const outfile=join(dir,'tools.mjs');
  await build({entryPoints:['source/node-agent-coordinator/birdeye-tools.ts'],outfile,bundle:true,platform:'node',format:'esm'});
  const {createDefaultBirdeyePort,executeBirdeyeRoutedTool}=await import(pathToFileURL(outfile));
  const mint='So11111111111111111111111111111111111111112';
  const token='a'.repeat(43),calls=[];
  const port=createDefaultBirdeyePort({env:{BIRDEYE_API_KEY:'personal-key'},revealSecret:async key=>{
    if(key==='SAND_HOSTED_GATEWAY_URL')return 'https://gateway.test';
    if(key==='SAND_HOSTED_GATEWAY_TOKEN')return token;
    throw new Error('Must not reveal a provider key');
  },fetchImpl:async(url,init)=>{
    calls.push({url,init});
    assert.equal(url,'https://gateway.test/birdeye/request');
    assert.deepEqual(init.headers,{authorization:'Bearer '+token,'content-type':'application/json'});
    assert.equal(init.redirect,'error');
    assert.equal(init.method,'POST');
    assert.deepEqual(JSON.parse(init.body),{action:'price',mints:[mint]});
    return Response.json({success:true,data:{[mint]:{value:123,priceChange24h:2,updateUnixTime:10}}});
  }});
  const result=await executeBirdeyeRoutedTool(port,'birdeye_token_price',{mints:[mint]});
  assert.equal(result.found[mint].priceUsd,123);
  await assert.rejects(port.fetchImpl('https://evil.test/private'),/Unsupported/);
  assert.equal(calls.length,1);
  const broken=createDefaultBirdeyePort({env:{SAND_HOSTED_GATEWAY_URL:'https://gateway.test',SAND_HOSTED_GATEWAY_TOKEN:token,BIRDEYE_API_KEY:'personal-key'},fetchImpl:async(url)=>{
    assert.equal(url,'https://gateway.test/birdeye/request');
    return Response.json({message:'provider-secret'},{status:403});
  }});
  await assert.rejects(executeBirdeyeRoutedTool(broken,'birdeye_token_overview',{mint}),error=>!error.message.includes('provider-secret')&&error.message.includes('403'));
  const incomplete=createDefaultBirdeyePort({env:{SAND_HOSTED_GATEWAY_URL:'https://gateway.test',BIRDEYE_API_KEY:'personal-key'},revealSecret:async()=>null});
  await assert.rejects(incomplete.apiKey(),/valid user access token/);
});

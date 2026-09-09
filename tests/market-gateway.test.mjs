import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketService, marketRequest, normalizeCandles } from '../services/provider-gateway/market.mjs';
import { pumpRequest } from '../services/provider-gateway/pump.mjs';
const mint='So11111111111111111111111111111111111111112',pool='Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
test('market inputs reject arbitrary hosts, unknown chains, invalid addresses and ranges',()=>{
  for(const body of [{action:'snapshot',network:'internal',address:mint,range:'24h'}, {action:'snapshot',network:'solana',address:'../private',range:'24h'}, {action:'search',query:'sol',url:'http://internal'}, {action:'search',query:' '.repeat(200)}])assert.equal(marketRequest(body),null);
  assert.equal(marketRequest({action:'snapshot',network:'solana',address:mint,range:'7d'}).address,mint);
  assert.equal(marketRequest({action:'snapshot',network:'solana',address:'wrapped-sol',range:'7d'}).address,mint);
  assert.equal(marketRequest({action:'snapshot',network:'solana',address:mint.slice(0,-2)+'2',range:'7d'}),null);
});
test('candles retain real time gaps, sort observations and discard invalid or future data',()=>{
  const rows=[[300,2,3,1,2.5,10],[100,1,2,0.5,1.5,5],[100,1,2,0.5,1.5,5],[200,4,2,1,3,5],[400,1,2,0,1,5],[250,1,2,0,1,-1]];
  const result=normalizeCandles(rows,300000);
  assert.deepEqual(result.map(c=>c.time),[100,300]);assert.equal(result[1].volume,10);
});
test('market snapshots verify pool orientation, select correct price, cache with original retrieval time',async()=>{
  let time=1000000,calls=0;
  const service=createMarketService({now:()=>time,fetchImpl:async(url,init)=>{
    calls++;assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,undefined);
    if(url.includes('/ohlcv/')){assert.ok(url.includes('token=quote'));return Response.json({meta:{quote:{address:mint,name:'Wrapped SOL',symbol:'SOL'}},data:{attributes:{ohlcv_list:[[900,1,3,1,2,5]]}}});}
    return Response.json({data:[{attributes:{address:pool,name:'TOKEN / SOL',quote_token_price_usd:'100',base_token_price_usd:'2',reserve_in_usd:'2000',volume_usd:{h24:'500'},market_cap_usd:'999'},relationships:{base_token:{data:{id:'solana_other'}},quote_token:{data:{id:'solana_'+mint}},dex:{data:{id:'orca'}}}}]});
  }});
  const input=marketRequest({action:'snapshot',network:'solana',address:mint,range:'24h'}),signal=new AbortController().signal;
  const result=await service(input,signal);
  assert.equal(result.priceUsd,100);assert.equal(result.marketCapUsd,null);assert.equal(result.priceChange24hPercent,null);
  time+=1000;assert.equal((await service(input,signal)).retrievedAt,result.retrievedAt);assert.equal(calls,2);
});
test('market rejects historical data for the wrong token',async()=>{
  const service=createMarketService({now:()=>1000000,fetchImpl:async(url)=>Response.json(url.includes('/ohlcv/')?{meta:{base:{address:'foreign'}}}:{data:[{attributes:{address:pool},relationships:{base_token:{data:{id:'solana_'+mint}}}}]})});
  await assert.rejects(service({action:'snapshot',network:'solana',address:mint,range:'24h'},new AbortController().signal),/does not match/);
});
test('Pump proxy restricts the operator credential to the fixed host and read-only tool names',async()=>{
  let calls=0;
  const options={apiKey:'private-pump',signal:new AbortController().signal,fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,'https://solgpt-pumpfun-mcp.fly.dev/mcp');assert.equal(init.headers.authorization,'Bearer private-pump');assert.equal(init.redirect,'error');
    return Response.json({result:{tools:[{name:'search-docs',inputSchema:{type:'object'}},{name:'ows-sign-tx',inputSchema:{}}]}});
  }};
  const listed=await pumpRequest({jsonrpc:'2.0',id:1,method:'tools/list'},options);
  assert.deepEqual(listed.result.tools.map(t=>t.name),['search-docs']);
  const denied=await pumpRequest({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'ows-sign-tx',arguments:{}}},options);
  assert.equal(denied.error.code,-32602);assert.equal(calls,1);
});

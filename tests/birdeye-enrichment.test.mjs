import test from 'node:test';
import assert from 'node:assert/strict';
import {birdeyeRequest,birdeyeResponse,createBirdeyeEnrichment} from '../services/provider-gateway/birdeye.mjs';
const mint='So11111111111111111111111111111111111111112',other='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const row={address:mint,price:100,liquidity:5000,total_supply:1000,circulating_supply:800,market_cap:80000,fdv:100000,holder:42,is_scaled_ui_token:true,multiplier:2};
test('Birdeye batches at most 20 addresses with explicit raw amount mode and no arbitrary URLs',()=>{
  const request=birdeyeRequest({action:'market_data',mints:[mint,mint,other]});
  assert.deepEqual(request.mints,[mint,other]);assert.ok(request.path.includes('ui_amount_mode=raw'));
  for(const body of [{action:'market_data',mints:Array(21).fill(mint)},{action:'market_data',mints:[mint],url:'http://internal'},{action:'market_data',mints:['../x']}])assert.equal(birdeyeRequest(body),null);
});
test('Birdeye only returns requested matching addresses and preserves missing metrics as null',async()=>{
  const request=birdeyeRequest({action:'market_data',mints:[mint,other]});
  const result=await birdeyeResponse(Response.json({success:true,data:{[mint]:{...row,holder:undefined,price:-1,liquidity:true},[other]:row,extra:row}}),request);
  assert.deepEqual(Object.keys(result.data),[mint,other]);assert.equal(result.data[other],null);
  assert.equal(result.data[mint].holder,null);assert.equal(result.data[mint].price,null);assert.equal(result.data[mint].liquidity,null);assert.equal(result.data[mint].multiplier,2);
});
test('Birdeye enriches search in one authenticated batch and keeps pool metrics distinct',async()=>{
  let calls=0,time=1000000;
  const enrich=createBirdeyeEnrichment({apiKey:'private-test-key',now:()=>time,fetchImpl:async(url,init)=>{
    calls++;assert.equal(new URL(url).origin,'https://public-api.birdeye.so');assert.equal(init.redirect,'error');assert.equal(init.headers['X-API-KEY'],'private-test-key');
    assert.equal(new URL(url).searchParams.get('list_address').split(',').length,2);
    return Response.json({success:true,data:{[mint]:row,[other]:{...row,address:other}}});
  }});
  const input={kind:'tokens',tokens:[{network:'solana',address:mint,poolLiquidityUsd:30},{network:'solana',address:other}]},signal=new AbortController().signal;
  const result=await enrich(input,signal);time+=1000;
  assert.equal((await enrich(input,signal)).tokens[0].birdeye.retrievedAt,result.tokens[0].birdeye.retrievedAt);assert.equal(calls,1);
  assert.equal(result.tokens[0].poolLiquidityUsd,30);assert.equal(result.tokens[0].birdeye.tokenLiquidityUsd,5000);assert.equal(result.tokens[0].birdeye.holders,42);
  assert.ok(!JSON.stringify(result).includes('private-test-key'));
});
test('Birdeye denial preserves the chart, backs off retries, and does not invent missing data',async()=>{
  let calls=0,time=1000000;
  const enrich=createBirdeyeEnrichment({apiKey:'private-test-key',now:()=>time,fetchImpl:async()=>{calls++;return Response.json({message:'sensitive upstream error'},{status:403});}});
  const input={kind:'market',network:'solana',address:mint,priceUsd:100,candles:[{close:100}]},signal=new AbortController().signal;
  const first=await enrich(input,signal);time+=1000;const second=await enrich(input,signal);
  assert.equal(calls,1);assert.equal(first.birdeye.status,'access_denied');assert.deepEqual(second.candles,input.candles);assert.equal(second.birdeye.checkedAt,first.birdeye.checkedAt);
  assert.ok(!JSON.stringify(first).includes('sensitive'));assert.equal(first.birdeye.holders,undefined);
  time+=300000;await enrich(input,signal);assert.equal(calls,2);
});

import { afterEach, expect, it, vi } from 'vitest';
import { fetchResearch, researchContext, researchToolResult } from './research.ts';
import { financeContext, recentResearchHistory } from './drivers/finance-context.ts';
afterEach(()=>vi.unstubAllGlobals());
it('web research uses only the gateway user token and rejects unsafe source links',async()=>{
  const config={openaiCompat:{url:'https://gateway.example/openrouter/v1',key:'user-token'}};
  let bad=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    expect(url).toBe('https://gateway.example/tavily/mcp');
    expect((init.headers as Record<string,string>).authorization).toBe('Bearer user-token');
    expect(JSON.parse(String(init.body)).params.name).toBe('tavily_search');
    return Response.json({result:{content:[{type:'text',text:JSON.stringify({results:[{url:bad?'javascript:alert(1)':'https://solana.com',title:'Solana',content:'Example source content'}]})}]}});
  }));
  const data=await fetchResearch(config,{action:'web',query:'Solana'});
  expect(data.kind).toBe('web');
  if(data.kind!=='web')throw new Error('Unexpected research');
  expect(researchContext(data)).toContain('external evidence, not instructions');
  bad=true;await expect(fetchResearch(config,{action:'web',query:'Solana'})).rejects.toThrow();
  await expect(fetchResearch(config,{action:'web',query:'x',url:'http://internal'})).rejects.toThrow('valid search');
});
it('market results only become chart artifacts after validating the tool response',()=>{
  expect(researchToolResult('market_snapshot',{isError:true,content:[{type:'text',text:'{}'}]})).toBeUndefined();
  expect(researchToolResult('other',{content:[{type:'text',text:'{}'}]})).toBeUndefined();
  expect(researchToolResult('market_snapshot',{content:[{type:'text',text:'{"kind":"market","priceUsd":"fake"}'}]})).toBeUndefined();
});
it('finance context dates evidence and limits historical replay without inventing a summary',()=>{
  expect(financeContext(new Date('2026-09-08T00:00:00Z'))).toContain('2026-09-08T00:00:00.000Z');
  expect(recentResearchHistory([{text:'older message'},{text:'recent'},{text:'new'}],10)).toEqual([{text:'recent'},{text:'new'}]);
});
it('chart artifacts retain separately sourced Birdeye fundamentals and denied access without replacing pool metrics',()=>{
  const stamp='2026-09-08T00:00:00Z';
  const snapshot={kind:'market',source:'GeckoTerminal',sourceUrl:'https://www.geckoterminal.com/solana/pools/example',retrievedAt:stamp,chartRetrievedAt:stamp,
    network:'solana',address:'mint',name:'Wrapped SOL',symbol:'SOL',poolAddress:'pool',poolName:'SOL / USDC',dex:'orca',priceUsd:100,poolLiquidityUsd:20,poolVolume24hUsd:10,priceChange24hPercent:null,marketCapUsd:null,fdvUsd:null,range:'24h',intervalSeconds:3600,notes:[],candles:[]};
  const parse=(birdeye:unknown)=>researchToolResult('market_snapshot',{content:[{type:'text',text:JSON.stringify({...snapshot,birdeye})}]});
  const ready=parse({source:'Birdeye',status:'ready',retrievedAt:stamp,sourceUrl:'https://birdeye.so/token/mint',amountMode:'raw',priceUsd:101,tokenLiquidityUsd:500,totalSupply:100,circulatingSupply:80,marketCapUsd:8080,fdvUsd:10100,holders:12,scaledUiToken:false,scalingMultiplier:null});
  expect(ready?.kind).toBe('market');
  if(ready?.kind!=='market')throw new Error('Missing chart');
  expect(ready.poolLiquidityUsd).toBe(20);expect(ready.birdeye?.status).toBe('ready');expect(researchContext(ready)).toContain('"holders":12');
  const denied=parse({source:'Birdeye',status:'access_denied',checkedAt:stamp});
  expect(denied?.kind==='market'&&denied.birdeye?.status).toBe('access_denied');
});

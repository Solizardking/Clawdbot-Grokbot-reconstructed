import {readFile} from 'node:fs/promises';
import {parseHostedAccessFile} from './lib/hosted-access-file.mjs';
const access=parseHostedAccessFile(await readFile(process.argv[2],'utf8'));
const requests=[
  ['/pump/mcp',{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}],
  ['/pump/mcp',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get-program-ids',arguments:{}}}],
  ['/market/request',{action:'search',query:'SOL'}],
  ...['24h','7d','30d'].map(range=>['/market/request',{action:'snapshot',network:'solana',address:'So11111111111111111111111111111111111111112',range}]),
];
for(const [path,body] of requests) {
  const response=await fetch(access.url+path,{method:'POST',headers:{authorization:`Bearer ${access.token}`,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(45000),body:JSON.stringify(body)});
  const data=await response.json();
  console.log(JSON.stringify({path,action:body.action??body.method,status:response.status,tools:data.result?.tools?.map(t=>t.name),isError:data.result?.isError,
    tokenCount:data.tokens?.length,name:data.name,range:data.range,candles:data.candles?.length,priceUsd:data.priceUsd,source:data.source,retrievedAt:data.retrievedAt,birdeye:data.birdeye,error:data.error}));
  if(!response.ok||data.error||data.result?.isError)process.exitCode=1;
}

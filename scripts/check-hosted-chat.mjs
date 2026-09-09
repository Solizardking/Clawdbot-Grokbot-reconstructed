import {readFile} from 'node:fs/promises';
import {parseHostedAccessFile} from './lib/hosted-access-file.mjs';
import {runHostedChat} from '../clawd/server/drivers/hosted-chat.ts';
const [file,provider='openrouter',model='nvidia/nemotron-3.5-lightning:free']=process.argv.slice(2);
if(!['openrouter','novita','nvidia'].includes(provider))throw new Error('Unsupported provider');
const access=parseHostedAccessFile(await readFile(file,'utf8'));
const nativeFetch=globalThis.fetch;let step=0;
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(init.body);
 if(String(url).endsWith('/chat/completions')){
  step++;
  if(provider==='openrouter')body.reasoning={enabled:true,effort:'low'};
  console.log(JSON.stringify({event:'model_request',step,messageRoles:body.messages.map(m=>m.role),reasoningDetails:body.messages.flatMap(m=>(m.reasoning_details??[]).map(d=>({type:d.type,index:d.index,format:d.format,length:JSON.stringify(d).length})))}));
 }
 const response=await nativeFetch(url,{...init,body:JSON.stringify(body)});
 console.log(JSON.stringify({event:'response',route:new URL(url).pathname,status:response.status}));
 return response;
};
let textChars=0,reasoningChars=0;
try{
 const result=await runHostedChat({baseUrl:access.url+'/'+provider+'/v1',key:access.token,model,messages:[{role:'user',content:'Use tavily_search exactly once for official Solana documentation with max_results 1. Return the source URL from the result and HOSTED_SEARCH_READY.'}],signal:AbortSignal.timeout(150000),onDelta:(text,kind)=>{if(kind==='assistant_text')textChars+=text.length;else reasoningChars+=text.length;},onTool:(name,state,id)=>console.log(JSON.stringify({event:'tool',name,state,id}))});
 console.log(JSON.stringify({event:'completed',text:result.text,usage:result.usage,textChars,reasoningChars}));
}catch(error){console.log(JSON.stringify({event:'failed',name:error.name,message:error.message,textChars,reasoningChars}));process.exitCode=1;}

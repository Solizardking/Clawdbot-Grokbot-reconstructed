import type { ResearchData } from '../../shared/research.ts';
import { researchToolResult } from '../research.ts';
import { createHash } from 'node:crypto';
const toolCatalogs=new Map<string,{at:number;tools:any[];routes:Array<[string,string]>}>();
type Message = {role:string;content:string|null;[key:string]:unknown};
type ToolCall = {id:string;type:'function';function:{name:string;arguments:string}};
export async function runHostedChat(input:{sandbox?:boolean;market?:boolean;pump?:boolean;composio?:boolean;web?:boolean;baseUrl:string;key:string;model:string;messages:Message[];signal:AbortSignal;onDelta:(text:string,kind:'assistant_text'|'reasoning_text')=>void;onTool:(name:string,state:'start'|'done'|'error',itemId:string,research?:ResearchData)=>void}) {
  const base=new URL(input.baseUrl);
  if(!/^\/(openrouter|novita|xai|nvidia)\/v1\/?$/.test(base.pathname)||base.username||base.password||base.search||base.hash)throw new Error('Hosted tools require a gateway provider URL');
  const headers={authorization:`Bearer ${input.key}`,'content-type':'application/json'};
  let rpcId=0;
  const rpc=async(method:string,params:unknown,path='/tavily/mcp')=>{
    const response=await fetch(base.origin+path,{method:'POST',headers,redirect:'error',signal:input.signal,body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params})});
    if(!response.ok) {
      await response.body?.cancel();
      if(method==='tools/call')return {isError:true,content:[{type:'text',text:`The tool request failed (HTTP ${response.status}). No data was returned. Verify the exact token address with market_search if requesting a market snapshot. Do not invent missing data or repeat the same failed call.`}]};
      throw new Error(`Hosted web tools unavailable (HTTP ${response.status})`);
    }
    const body:any=await response.json();
    if(body.error)throw new Error('Hosted web tool request failed');
    return body.result;
  };
  const routes=new Map<string,string>();
  const tools:any[]=[];
  const endpoints=[...(input.web!==false?['/tavily/mcp']:[]),...(input.composio?['/composio/v1/mcp']:[]),...(input.market?['/market/mcp']:[]),...(input.pump?['/pump/mcp']:[])];
  const cacheKey=createHash('sha256').update(JSON.stringify([base.origin,input.key,endpoints,input.sandbox===true])).digest('hex');
  const cached=toolCatalogs.get(cacheKey);
  if(cached&&Date.now()-cached.at<300000) {
    tools.push(...cached.tools);for(const [name,path] of cached.routes)routes.set(name,path);
  } else for(const endpoint of endpoints) {
    await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'clawd-bot',version:'1.0.0'}},endpoint);
    const catalog=await rpc('tools/list',{},endpoint);
    if(!Array.isArray(catalog.tools))throw new Error('Invalid hosted tool catalog');
    for(const tool of catalog.tools) {
      const allowed=endpoint==='/tavily/mcp'?['tavily_search','tavily_extract'].includes(tool.name):endpoint==='/market/mcp'?['market_search','market_snapshot'].includes(tool.name):endpoint==='/pump/mcp'?tool.annotations?.readOnlyHint===true:(tool.name.startsWith('CUSTOM_SOLGPT_')&&tool.annotations?.readOnlyHint===true)||(input.sandbox===true&&['COMPOSIO_REMOTE_WORKBENCH','COMPOSIO_REMOTE_BASH_TOOL'].includes(tool.name));
      if(!allowed)continue;
      routes.set(tool.name,endpoint);
      tools.push({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema}});
    }
  }
  if(!cached||Date.now()-cached.at>=300000){if(toolCatalogs.size>=50)toolCatalogs.delete(toolCatalogs.keys().next().value!);toolCatalogs.set(cacheKey,{at:Date.now(),tools,routes:[...routes]});}
  const offered=new Set(routes.keys());
  const messages=[...input.messages];
  // An explicit request for a read-only research tool must not be satisfied
  // with a quote copied from an earlier turn. Only inspect the latest user
  // message, never tool output or historical instructions.
  const latestUser=messages.findLast(message=>message.role==='user')?.content??'';
  const requestedResearchTool=/(?:^|[.!?:]\s+)(?:please\s+)?(?:call|use|run)\s+(market_snapshot|market_search|tavily_search|tavily_extract)\b/i.exec(latestUser)?.[1]?.toLowerCase();
  const requiredTool=requestedResearchTool&&offered.has(requestedResearchTool)?requestedResearchTool:undefined;
  let text='',reasoning='',totalInput=0,totalOutput=0;
  for(let step=0;step<6;step++) {
    const response=await fetch(input.baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers,redirect:'error',signal:input.signal,
      body:JSON.stringify({model:input.model,messages,tools,...(step===0&&requiredTool?{tool_choice:{type:'function',function:{name:requiredTool}}}:{}),stream:true,max_tokens:4096,stream_options:{include_usage:true},...(base.pathname.startsWith('/openrouter/')?{reasoning:{enabled:true}}:{})})});
    if(!response.ok)throw new Error(`Hosted model request failed (HTTP ${response.status})`);
    if(!response.body)throw new Error('Hosted model returned no stream');
    const calls=new Map<number,ToolCall>();
    const details=new Map<number,Record<string,any>>();
    let stepText='',stepReasoning='',pending='';const decoder=new TextDecoder();
    const consume=(line:string)=>{
      if(!line.startsWith('data:'))return;
      const data=line.slice(5).trim();if(!data||data==='[DONE]')return;
      const chunk=JSON.parse(data),delta=chunk.choices?.[0]?.delta;
      if(chunk.error)throw new Error('Hosted model stream failed');
      if(typeof delta?.content==='string'){
        stepText+=delta.content;
        if(!(step===0&&requiredTool)){text+=delta.content;input.onDelta(delta.content,'assistant_text');}
      }
      const thought=delta?.reasoning??delta?.reasoning_content;
      if(typeof thought==='string'){stepReasoning+=thought;reasoning+=thought;input.onDelta(thought,'reasoning_text');}
      for(const part of delta?.reasoning_details??[]) {
        const index=part.index??0,previous=details.get(index)??{},merged={...previous,...part};
        for(const key of ['text','summary','data'])if(typeof previous[key]==='string'&&typeof part[key]==='string')merged[key]=previous[key]+part[key];
        details.set(index,merged);
      }
      for(const part of delta?.tool_calls??[]) {
        const call=calls.get(part.index)??{id:'',type:'function',function:{name:'',arguments:''}};
        if(part.id)call.id=part.id;
        if(part.function?.name)call.function.name+=part.function.name;
        if(part.function?.arguments)call.function.arguments+=part.function.arguments;
        calls.set(part.index,call);
      }
      if(chunk.usage){totalInput+=chunk.usage.prompt_tokens??0;totalOutput+=chunk.usage.completion_tokens??0;}
    };
    for await(const bytes of response.body as any){pending+=decoder.decode(bytes,{stream:true});let index;while((index=pending.indexOf('\n'))>=0){consume(pending.slice(0,index).trim());pending=pending.slice(index+1);}}
    pending+=decoder.decode();if(pending.trim())consume(pending.trim());
    if(step===0&&requiredTool&&![...calls.values()].some(call=>call.function.name===requiredTool))throw new Error('The model did not perform the requested live research. No fresh result was obtained.');
    if(!calls.size){if(!stepText.trim())throw new Error('Hosted model returned no final answer');return {text,reasoning,usage:{input:totalInput,output:totalOutput}};}
    messages.push({role:'assistant',content:stepText||null,tool_calls:[...calls.values()],...(details.size?{reasoning_details:[...details.values()]}:stepReasoning?{reasoning:stepReasoning}:{})});
    for(const call of calls.values()) {
      if(!call.id||!offered.has(call.function.name))throw new Error('Model requested an unavailable hosted tool');
      input.onTool(call.function.name,'start',call.id);
      try {
        const result=await rpc('tools/call',{name:call.function.name,arguments:JSON.parse(call.function.arguments||'{}')},routes.get(call.function.name));
        const evidence=(result.content??[]).filter((part:any)=>part.type==='text').map((part:any)=>String(part.text??'')).join('\n');
        let data:unknown=evidence;
        try {data=JSON.parse(evidence);}catch{}
        messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({isError:result.isError===true,data:evidence.length>24000?evidence.slice(0,24000):data,truncated:evidence.length>24000})});
        input.onTool(call.function.name,result.isError?'error':'done',call.id,researchToolResult(call.function.name,result));
      }catch(error){input.onTool(call.function.name,'error',call.id);throw error;}
    }
  }
  throw new Error('Hosted tool step limit reached');
}

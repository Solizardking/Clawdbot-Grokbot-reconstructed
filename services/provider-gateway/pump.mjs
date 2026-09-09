export const PUMP_TOOLS = ['get-token-info','get-account-balance','inspect-fees','get-fee-recipients','get-fee-tiers','get-program-ids','search-docs','get-instruction','get-idl','parse-program-logs','dflow-docs-index','dflow-priority-fees'];
export async function pumpRequest(body, { fetchImpl, apiKey, signal }) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0') throw Object.assign(new Error('Invalid MCP request'),{status:400});
  const result = value => ({jsonrpc:'2.0',id:body.id??null,result:value});
  if(body.method==='initialize')return result({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'clawd-pump',version:'1.0.0'}});
  if(body.method==='ping')return result({});
  if(body.method==='notifications/initialized')return null;
  if(body.method!=='tools/list' && !(body.method==='tools/call'&&PUMP_TOOLS.includes(body.params?.name)))return {jsonrpc:'2.0',id:body.id??null,error:{code:-32602,message:'Unsupported Pump research tool'}};
  const response=await fetchImpl('https://solgpt-pumpfun-mcp.fly.dev/mcp',{method:'POST',redirect:'error',signal,
    headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json',accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id:body.id??1,method:body.method,params:body.method==='tools/list'?{}:{name:body.params.name,arguments:body.params.arguments??{}}})});
  if(!response.ok){await response.body?.cancel();throw new Error('Pump service unavailable');}
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>2_097_152)throw new Error('Pump response too large');chunks.push(chunk);}
  const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(parsed.error)return {jsonrpc:'2.0',id:body.id??null,error:{code:-32000,message:'Pump research request failed'}};
  if(body.method==='tools/list') {
    if(!Array.isArray(parsed.result?.tools))throw new Error('Invalid Pump tool catalog');
    return result({tools:parsed.result.tools.filter(tool=>PUMP_TOOLS.includes(tool.name)).map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.inputSchema,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}}))});
  }
  return result(parsed.result?.isError ? {isError:true,content:[{type:'text',text:'Pump data unavailable for this request.'}]} : {isError:false,content:parsed.result?.content??[]});
}

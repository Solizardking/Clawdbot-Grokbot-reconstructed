import { isIP } from 'node:net';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const tools = [
  {name:'tavily_search',description:'Search the web and return source URLs and text excerpts.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:1000},max_results:{type:'integer',minimum:1,maximum:5}},required:['query'],additionalProperties:false}},
  {name:'tavily_extract',description:'Read public web pages and return their text with source URLs.',inputSchema:{type:'object',properties:{urls:{type:'array',items:{type:'string'},minItems:1,maxItems:5}},required:['urls'],additionalProperties:false}},
].map(tool=>({...tool,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}}));

export function tavilyRequest(request) {
  if (!object(request) || request.jsonrpc!=='2.0' || typeof request.method!=='string') return null;
  const id=request.id;
  if(id!==undefined && typeof id!=='string' && (typeof id!=='number'||!Number.isFinite(id))) return null;
  const reply=result=>({kind:'reply',status:200,body:{jsonrpc:'2.0',id,result}});
  if(request.method==='notifications/initialized' && id===undefined) return {kind:'reply',status:202};
  if(id===undefined) return null;
  if(request.method==='initialize') return reply({protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'hosted-tavily',version:'1.0.0'}});
  if(request.method==='ping') return reply({});
  if(request.method==='tools/list') return reply({tools});
  if(request.method!=='tools/call') return {kind:'reply',status:200,body:{jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}}};
  const params=request.params,args=params?.arguments ?? {};
  if(!object(params)||!object(args)) return null;
  if(params.name==='tavily_search') {
    if(Object.keys(args).some(key=>!['query','max_results'].includes(key)) || typeof args.query!=='string' || !args.query.trim() || args.query.length>1000 || (args.max_results!==undefined && (!Number.isInteger(args.max_results)||args.max_results<1||args.max_results>5))) return null;
    return {kind:'call',id,path:'/search',body:{query:args.query,max_results:args.max_results??3,search_depth:'basic',include_answer:false,include_raw_content:false}};
  }
  if(params.name==='tavily_extract') {
    if(Object.keys(args).some(key=>key!=='urls') || !Array.isArray(args.urls) || args.urls.length<1 || args.urls.length>5) return null;
    for(const raw of args.urls) {
      try {const url=new URL(raw);if(typeof raw!=='string'||raw.length>2048||!['https:','http:'].includes(url.protocol)||url.username||url.password||isIP(url.hostname.replace(/^\[|\]$/g,''))||/\.(local|internal)$/.test(url.hostname)||!url.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname))return null;} catch{return null;}
    }
    return {kind:'call',id,path:'/extract',body:{urls:args.urls,extract_depth:'basic',format:'text'}};
  }
  return null;
}

export async function tavilyResponse(response, request) {
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>2_000_000)throw new Error('Tavily response too large');chunks.push(chunk);}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!object(data)||!Array.isArray(data.results))throw new Error('Invalid Tavily response');
  const result={results:data.results.slice(0,5).map(row=>({url:String(row.url??'').slice(0,2048),title:String(row.title??'').slice(0,1000),content:String(row.content??row.raw_content??'').slice(0,20000)}))};
  return {jsonrpc:'2.0',id:request.id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}};
}

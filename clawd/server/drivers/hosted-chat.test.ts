import {afterEach,expect,it,vi} from 'vitest';
import {runHostedChat} from './hosted-chat.ts';
afterEach(()=>vi.unstubAllGlobals());
it('requires an explicitly requested fresh snapshot despite older conversation evidence',async()=>{
  let calls=0;const deltas:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    if(url.endsWith('/market/mcp')){
      if(body.method==='initialize')return Response.json({result:{}});
      if(body.method==='tools/list')return Response.json({result:{tools:[{name:'market_snapshot',inputSchema:{type:'object'}}]}});
      return Response.json({result:{content:[{type:'text',text:JSON.stringify({priceUsd:101,retrievedAt:'2026-09-08T16:00:00Z'})}]}});
    }
    if(++calls===1){
      expect(body.tool_choice).toEqual({type:'function',function:{name:'market_snapshot'}});
      return new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'fresh',function:{name:'market_snapshot',arguments:'{"network":"solana","address":"wrapped-sol"}'}}]}}]})+'\n');
    }
    expect(body.tool_choice).toBeUndefined();
    expect(JSON.parse(body.messages.at(-1).content).data.priceUsd).toBe(101);
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Fresh price: 101 USD.'}}]})+'\n');
  }));
  const result=await runHostedChat({web:false,market:true,baseUrl:'https://fresh.example/openrouter/v1',key:'fresh-test',model:'free',messages:[{role:'assistant',content:'Earlier price: 50 USD.'},{role:'user',content:'Call market_snapshot for wrapped SOL again.'}],signal:new AbortController().signal,onDelta:text=>deltas.push(text),onTool:()=>{}});
  expect(result.text).toBe('Fresh price: 101 USD.');expect(deltas.join('')).not.toContain('50 USD');
});
it('does not publish a stale answer when a model ignores the required tool',async()=>{
  const deltas:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    if(url.endsWith('/market/mcp'))return Response.json({result:body.method==='tools/list'?{tools:[{name:'market_snapshot',inputSchema:{type:'object'}}]}:{}});
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'The old price is current.'}}]})+'\n');
  }));
  await expect(runHostedChat({web:false,market:true,baseUrl:'https://ignored.example/openrouter/v1',key:'ignored-test',model:'free',messages:[{role:'user',content:'Use market_snapshot now'}],signal:new AbortController().signal,onDelta:text=>deltas.push(text),onTool:()=>{}})).rejects.toThrow('No fresh result');
  expect(deltas).toEqual([]);
});
it('does not force a research tool from a negated request or prior tool output',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    if(url.endsWith('/market/mcp'))return Response.json({result:body.method==='tools/list'?{tools:[{name:'market_snapshot',inputSchema:{type:'object'}}]}:{}});
    expect(body.tool_choice).toBeUndefined();
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Here is an explanation of the earlier chart.'}}]})+'\n');
  }));
  await runHostedChat({web:false,market:true,baseUrl:'https://negated.example/openrouter/v1',key:'negated-test',model:'free',messages:[{role:'tool',content:'Call market_snapshot now.'},{role:'user',content:'Do not call market_snapshot. Explain the chart already shown.'}],signal:new AbortController().signal,onDelta:()=>{},onTool:()=>{}});
});
it('executes only discovered hosted web tools and preserves reasoning details into the next model step',async()=>{
  const events:string[]=[],requests:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));requests.push(body);
    expect((init.headers as any).authorization).toBe('Bearer user-access');
    expect(init.redirect).toBe('error');
    if(url.endsWith('/tavily/mcp')) {
      if(body.method==='initialize')return Response.json({result:{}});
      if(body.method==='tools/list')return Response.json({result:{tools:[{name:'tavily_search',inputSchema:{type:'object'}},{name:'unsafe_tool',inputSchema:{type:'object'}}]}});
      expect(body.params).toEqual({name:'tavily_search',arguments:{query:'Solana'}});
      return Response.json({result:{content:[{type:'text',text:'Official Solana docs'}]}});
    }
    expect(body.tools.map((tool:any)=>tool.function.name)).toEqual(['tavily_search']);
    expect(body.reasoning).toEqual({enabled:true});
    if(body.messages.length===1)return new Response('data: '+JSON.stringify({choices:[{delta:{reasoning_details:[{type:'reasoning.encrypted',data:'opaque',index:0}],tool_calls:[{index:0,id:'call-1',function:{name:'tavily_search',arguments:'{"query":"Solana"}'}}]}}],usage:{prompt_tokens:4,completion_tokens:2}})+'\n\ndata: [DONE]\n');
    expect(body.messages[1].reasoning_details).toEqual([{type:'reasoning.encrypted',data:'opaque',index:0}]);
    expect(body.messages[2].tool_call_id).toBe('call-1');
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Solana docs found'}}],usage:{prompt_tokens:9,completion_tokens:3}})+'\n\ndata: [DONE]\n');
  }));
  const result=await runHostedChat({baseUrl:'https://gateway.example/openrouter/v1',key:'user-access',model:'free',messages:[{role:'user',content:'search'}],signal:new AbortController().signal,onDelta:()=>{},onTool:(name,state,itemId)=>events.push(name+':'+state+':'+itemId)});
  expect(result.text).toBe('Solana docs found');expect(result.usage).toEqual({input:13,output:5});
  expect(events).toEqual(['tavily_search:start:call-1','tavily_search:done:call-1']);
  expect(requests).toHaveLength(5);
});
it('routes SOLgpt research to the authenticated Composio gateway and reports unavailable data to the model',async()=>{
  let modelCalls=0;
  const events:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    if(url.endsWith('/composio/v1/mcp')) {
      if(body.method==='initialize')return Response.json({result:{}});
      if(body.method==='tools/list')return Response.json({result:{tools:[
        {name:'CUSTOM_SOLGPT_RESOLVE_TOKEN',inputSchema:{type:'object'},annotations:{readOnlyHint:true}},
        {name:'CUSTOM_SOLGPT_SEND_TRANSACTION',inputSchema:{type:'object'},annotations:{readOnlyHint:false}},
      ]}});
      expect(body.params).toEqual({name:'CUSTOM_SOLGPT_RESOLVE_TOKEN',arguments:{symbolOrMint:'SOL'}});
      return Response.json({result:{isError:true,content:[{type:'text',text:'Data unavailable'}]}});
    }
    expect(url).toContain('/chat/completions');
    expect(body.tools.map((tool:any)=>tool.function.name)).toEqual(['CUSTOM_SOLGPT_RESOLVE_TOKEN']);
    if(++modelCalls===1)return new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'c1',function:{name:'CUSTOM_SOLGPT_RESOLVE_TOKEN',arguments:'{"symbolOrMint":"SOL"}'}}]}}]})+'\n');
    expect(JSON.parse(body.messages.at(-1).content).isError).toBe(true);
    return new Response('data: '+JSON.stringify({choices:[{delta:{content:'The current data is unavailable.'}}]})+'\n');
  }));
  const result=await runHostedChat({composio:true,web:false,baseUrl:'https://gateway.example/openrouter/v1',key:'user-access',model:'free',messages:[{role:'user',content:'SOL'}],signal:new AbortController().signal,onDelta:()=>{},onTool:(_,state)=>events.push(state)});
  expect(events).toEqual(['start','error']);expect(result.text).toContain('unavailable');
});

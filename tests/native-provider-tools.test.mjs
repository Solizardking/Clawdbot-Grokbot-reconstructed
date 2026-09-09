import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

test('native provider unwraps SDK schemas and returns tool calls for the host engine to execute',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'native-provider-tools-'));
  const names=['SAND_DATA_ROOT','SAND_HOSTED_GATEWAY_URL','SAND_HOSTED_GATEWAY_TOKEN','OPENROUTER_MODEL'];
  const saved=Object.fromEntries(names.map(key=>[key,process.env[key]]));
  const previousFetch=globalThis.fetch;
  t.after(async()=>{globalThis.fetch=previousFetch;for(const key of names){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]};await rm(dir,{recursive:true,force:true})});
  process.env.SAND_DATA_ROOT=dir;process.env.SAND_HOSTED_GATEWAY_URL='https://gateway.test';process.env.SAND_HOSTED_GATEWAY_TOKEN='a'.repeat(43);process.env.OPENROUTER_MODEL='openrouter/free';
  const schema={type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false};
  let calls=0;
  globalThis.fetch=async(input,init)=>{
    calls++;
    const request=new Request(input,init);
    assert.equal(request.url,'https://gateway.test/openrouter/v1/chat/completions');
    assert.equal(request.headers.get('authorization'),'Bearer '+'a'.repeat(43));
    const body=JSON.parse(await request.text());
    assert.deepEqual(body.tools[0].function.parameters,schema);
    const data=[{id:'test',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call-status',type:'function',function:{name:'status',arguments:'{"query":"ready"}'}}]},finish_reason:null}]},
      {id:'test',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}];
    return new Response(data.map(row=>'data: '+JSON.stringify(row)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  };
  const outfile=join(dir,'provider.cjs');
  await build({entryPoints:['source/host/extensions/inference/provider-session.ts'],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',define:{'import.meta.url':'__moduleUrl'},banner:{js:'const __moduleUrl = require("node:url").pathToFileURL(__filename).href;'}});
  const {createProviderPromptSession}=createRequire(import.meta.url)(outfile);
  const executor=createProviderPromptSession('openrouter').getExecutor([{role:'user',content:'Use status.'}]);
  const result=executor.stream({},'native-test',[{name:'status',description:'Check status',parameters:{jsonSchema:schema}}]);
  const chunks=[];for await(const chunk of result.fullStream)chunks.push(chunk);
  assert.equal(calls,1);
  const tool=chunks.find(chunk=>chunk.type==='tool-call');
  assert.equal(tool.toolName,'status');assert.deepEqual(tool.args,{query:'ready'});
  assert.equal((await result.response).messages[0].role,'assistant');
});

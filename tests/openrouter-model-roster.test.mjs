import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
async function load(path) {
  const {outputFiles}=await build({absWorkingDir:fileURLToPath(new URL('..', import.meta.url)),entryPoints:[fileURLToPath(new URL(path, import.meta.url))],bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent'});
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
const roster=await load('../source/shared/inference-router.ts');
const {createOpenRouterModelFetch}=await load('../source/shared/openrouter-model-fetch.ts');
test('requested slots are preserved and fallbacks dedupe in numeric order',()=>{
 assert.equal(Object.keys(roster.OPENROUTER_MODEL_PRESET).length,15);
 assert.equal(roster.OPENROUTER_MODEL_PRESET.OPENROUTER_MODEL6,undefined);
 assert.equal(roster.OPENROUTER_MODEL_PRESET.OPENROUTER_MODEL14,'nex-agi/nex-n2.5-mini:free');
 assert.equal(roster.OPENROUTER_MODEL_PRESET.OPENROUTER_MODEL15,'inclusionai/ling-3.0-flash-sante:free');
 assert.deepEqual(roster.resolveOpenRouterModelChain(roster.OPENROUTER_MODEL_PRESET), [...new Set(Object.values(roster.OPENROUTER_MODEL_PRESET))]);
 const empty=roster.resolveOpenRouterModelChain();
 assert.equal(empty.length,13);
 assert.ok(empty.includes('nex-agi/nex-n2.5-mini:free'));
 assert.ok(empty.includes('inclusionai/ling-3.0-flash-sante:free'));
 assert.deepEqual(roster.resolveOpenRouterModelChain({OPENROUTER_MODEL:'primary:free',OPENROUTER_MODEL11:'eleven:free',OPENROUTER_MODEL2:'two:free',OPENROUTER_MODEL1:'one:free',OPENROUTER_MODEL13:'two:free'}),['primary:free','one:free','two:free','eleven:free']);
});
test('primary env wins over legacy and stored pins; custom single-model pins stay single',()=>{
 assert.deepEqual(roster.resolveOpenRouterModelChain({OPENROUTER_MODEL:'chosen:free',SAND_OPENROUTER_MODEL:'legacy:free'},'stored:free'),['chosen:free']);
 assert.deepEqual(roster.resolveOpenRouterModelChain({},'stored:free'),['stored:free']);
 assert.deepEqual(roster.resolveOpenRouterModelChain({OPENROUTER_MODEL:' ',OPENROUTER_MODEL1:'invalid model',SAND_OPENROUTER_MODEL:'legacy:free'}),['legacy:free']);
 assert.deepEqual(roster.resolveOpenRouterModelChain({OPENROUTER_MODEL:'openrouter/auto',OPENROUTER_MODEL1:'one:free'}),['openrouter/auto']);
 assert.deepEqual(roster.resolveOpenRouterModelChain({},'openrouter/auto'),['openrouter/auto']);
});
test('wire wrapper preserves tools, messages and auth while adding native fallback models',async()=>{
 const calls=[]; const models=roster.resolveOpenRouterModelChain();
 const wrapped=createOpenRouterModelFetch(async(input,init)=>{calls.push({input,init});return new Response('{}')},models);
 const body={model:models[0],stream:true,messages:[{role:'tool',tool_call_id:'paid-once',content:'pending_approval'}],tools:[{type:'function',function:{name:'paybox_get_request'}}]};
 await wrapped('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)});
 assert.deepEqual(JSON.parse(calls[0].init.body),{...body,models:models.slice(0,3)});
 assert.equal(calls[0].init.headers.authorization,'Bearer test');
 const init={body:'untouched'}; await wrapped('https://api.x.ai/v1/chat/completions',init);
 assert.equal(calls[1].init,init);
 assert.equal(calls.length,2);
});

test('capacity errors advance through three-model groups without dropping tool results; auth errors stop',async()=>{
 const models=roster.resolveOpenRouterModelChain(), calls=[];
 const wrapped=createOpenRouterModelFetch(async(_,init)=>{
  const payload=JSON.parse(init.body);
  calls.push(payload);
  const last=payload.models[payload.models.length-1]===models[models.length-1];
  return new Response('{}',{status:last?200:503});
 },models);
 const messages=[{role:'tool',tool_call_id:'already-executed',content:'pending_approval'}];
 assert.equal((await wrapped('https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:JSON.stringify({model:models[0],messages})})).status,200);
 assert.deepEqual(calls.flatMap(c=>c.models),models);
 for(const c of calls) { assert.ok(c.models.length<=3); assert.equal(c.model,c.models[0]); assert.deepEqual(c.messages,messages); }
 let attempts=0;
 const denied=createOpenRouterModelFetch(async()=>{attempts++;return new Response('{}',{status:401});},models);
 assert.equal((await denied('https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:'{}'})).status,401);
 assert.equal(attempts,1);
});

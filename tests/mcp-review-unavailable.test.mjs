import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';

test('MCP classifier outages require explicit approval and never execute on denial or absent review UI',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mcp-review-outage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const outfile=join(dir,'test.cjs');
 await build({stdin:{contents:'export {createCallMcpTool} from "./source/packages/agent/tools/mcp/mcp.ts"; export {createContext} from "./source/packages/context/core.ts"; export {mcpExecutorResource} from "./source/packages/agent-exec/mcp.ts";',resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,mainFields:['module','main'],platform:'node',format:'cjs',logLevel:'silent',define:{'import.meta.url':'__moduleUrl'},banner:{js:'const __moduleUrl = require("node:url").pathToFileURL(__filename).href;'}});
 const {createCallMcpTool,createContext,mcpExecutorResource}=createRequire(import.meta.url)(outfile);
 let executions=0;
 const resourceAccessor={get:key=>key===mcpExecutorResource?{execute:async()=>{executions++;throw new Error('EXECUTOR_REACHED');}}:{execute:async()=>{throw new Error('classifier unavailable');}}};
 const invoke=provider=>{
  const tool=createCallMcpTool({resourceAccessor,smartModeClassifierMode:true,smartModeClassifierMaxAttempts:1,smartModeApprovalProvider:provider});
  return tool.execute(createContext(),{emitPartialToolCall:()=>{},executeToolCall:async(ctx,call,id,run)=>run(ctx)},(async function*(){yield JSON.stringify({server:'hosted-services',toolName:'hosted_services_status',arguments:{}});})(),{toolCallId:'review-outage'});
 };
 await assert.rejects(invoke(undefined),/review manually/);assert.equal(executions,0);
 await assert.rejects(invoke({requestApproval:async request=>{assert.match(request.target.blockReason,/review manually/);return {approved:false,reason:'User denied'};}}),/User denied/);assert.equal(executions,0);
 let approve,requested;
 const waiting=new Promise(resolve=>{requested=resolve;});
 const pending=invoke({requestApproval:async request=>{assert.equal(request.target.toolName,'hosted_services_status');assert.deepEqual(request.target.mcpArguments,{});requested();return new Promise(resolve=>{approve=resolve;});}});
 const result=assert.rejects(pending,/EXECUTOR_REACHED/);
 await waiting;assert.equal(executions,0);
 approve({approved:true});await result;assert.equal(executions,1);
});

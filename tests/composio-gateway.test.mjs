import test from 'node:test';
import assert from 'node:assert/strict';
import { createComposioBroker, SOLGPT_VERSION, SOLGPT_TOOLS } from '../services/provider-gateway/composio.mjs';
import { createGatewayStore } from '../services/provider-gateway/store.mjs';

const binding = { userId: 'owner', accountId: 'ca_owner', authConfigId: 'ac_owner' };
function fixture(t, options = {}) {
  const calls = [], store = createGatewayStore(':memory:'); t.after(() => store.close());
  const handler = createComposioBroker({ env: { COMPOSIO_API_KEY: 'private' }, now: () => 1000000, store,
    fetchImpl: async (url, init) => {
      assert.equal(init.headers['x-api-key'], 'private'); assert.equal(init.redirect, 'error');
      const body = init.body ? JSON.parse(init.body) : undefined; calls.push({ url, body });
      let result;
      if (url.includes('/connected_accounts/')) result = { user_id: options.foreign ? 'other' : 'owner', toolkit: { slug: 'custom_solgpt' }, auth_config: { id: 'ac_owner' }, status: 'ACTIVE' };
      else if (url.endsWith('/tool_router/session')) result = { session_id: 'trs_owned', config: { user_id: body.user_id } };
      else if (url.endsWith('/trs_owned/execute')) result = { data: options.sandboxFailed ? {error:'private execution error'} : { value: 6 } };
      else if (url.includes('/tools/execute/')) result = options.failed ? { successful: false, error: 'private diagnostic' } : { successful: true, data: { mint: 'mint', price: 1 }, log_id: 'private' };
      else result = { slug: url.split('/tools/')[1].split('?')[0], version: options.wrongVersion ? 'latest' : SOLGPT_VERSION, toolkit: { slug: 'custom_solgpt' }, input_parameters: { type: 'object' } };
      return Response.json(result);
    },
  });
  const run = (body, user = { id: 'alice', composio: binding }, path = '/composio/v1/mcp') => handler({ path, body, user, signal: new AbortController().signal });
  return { run, calls, store };
}
const call = args => ({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'CUSTOM_SOLGPT_RESOLVE_TOKEN', arguments: args } });
test('SOLgpt research pins the exact version and owned account, rejects credential overrides', async t => {
  const { run, calls } = fixture(t);
  const result = await run(call({ symbolOrMint: 'SOL' }));
  assert.equal(result.result.isError, false);
  assert.deepEqual(calls.at(-1).body, { user_id: 'owner', connected_account_id: 'ca_owner', version: SOLGPT_VERSION, arguments: { symbolOrMint: 'SOL' } });
  assert.ok(!JSON.stringify(result).includes('private'));
  await assert.rejects(run(call({ user_id: 'other' })), /Reserved/);
  await assert.rejects(run(call({}), { id: 'bob' }), /not been provisioned/);
  const denied = await run({ ...call({}), params: { name: 'CUSTOM_SOLGPT_SEND_TRANSACTION', arguments: {} } });
  assert.equal(denied.error.code, -32602);
});
test('sandbox access requires its own grant and never accepts a caller-selected session',async t=>{
  const {run,calls}=fixture(t);
  const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'COMPOSIO_REMOTE_WORKBENCH',arguments:{code_to_execute:'print(1+2+3)'}}};
  await assert.rejects(run(body),/not enabled/);assert.equal(calls.length,0);
  const user={id:'alice',composio:binding,services:['composio','sandbox']};
  await assert.rejects(run({...body,params:{...body.params,arguments:{...body.params.arguments,session_id:'foreign'}}},user),/Invalid sandbox arguments/);
  const result=await run(body,user);
  assert.equal(result.result.isError,false);
  assert.ok(calls.at(-1).url.endsWith('/trs_owned/execute'));
  assert.deepEqual(calls.at(-1).body,{tool_slug:'COMPOSIO_REMOTE_WORKBENCH',arguments:{code_to_execute:'print(1+2+3)'}});
  const failed=await fixture(t,{sandboxFailed:true}).run(body,user);
  assert.equal(failed.result.isError,true);assert.ok(!JSON.stringify(failed).includes('private execution error'));
});
test('SOLgpt rejects foreign accounts before execution and suppresses upstream error data', async t => {
  const foreign = fixture(t, { foreign: true });
  await assert.rejects(foreign.run(call({})), /ownership mismatch/);
  assert.equal(foreign.calls.length, 1);
  const failed = fixture(t, { failed: true });
  const result = await failed.run(call({}));
  assert.equal(result.result.isError, true); assert.ok(!JSON.stringify(result).includes('private'));
});
test('SOLgpt caches verified schemas, rejects version drift and reuses private sessions', async t => {
  const { run, calls, store } = fixture(t);
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  assert.equal((await run(list)).result.tools.length, SOLGPT_TOOLS.length);
  await run(list); assert.equal(calls.length, SOLGPT_TOOLS.length);
  await run({}, undefined, '/composio/v1/session'); await run({}, undefined, '/composio/v1/session');
  const creates = calls.filter(c => c.url.endsWith('/tool_router/session'));
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].body.connected_accounts, { custom_solgpt: ['ca_owner'] });
  assert.deepEqual(creates[0].body.tools.custom_solgpt.enable, SOLGPT_TOOLS);
  assert.equal(store.composioSession('bob', 'anything'), undefined);
  await assert.rejects(fixture(t, { wrongVersion: true }).run(list), /Unexpected/);
});

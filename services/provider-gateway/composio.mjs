import { createHash } from 'node:crypto';

export const SOLGPT_VERSION = '20260824_02';
export const SOLGPT_TOOLKIT = 'custom_solgpt';
// Research surface only. Execution, signing, transfers and account administration
// are not implicitly granted by a request for market context.
export const SOLGPT_TOOLS = [
  'CUSTOM_SOLGPT_RESOLVE_TOKEN', 'CUSTOM_SOLGPT_GET_PRICE', 'CUSTOM_SOLGPT_GET_CHART',
  'CUSTOM_SOLGPT_GET_TOKEN_OVERVIEW', 'CUSTOM_SOLGPT_GET_TRENDING',
  'CUSTOM_SOLGPT_GET_SOL_BALANCE', 'CUSTOM_SOLGPT_GET_WALLET_ASSETS',
  'CUSTOM_SOLGPT_GET_IMPERIAL_STATS_SUMMARY',
];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const SANDBOX_TOOLS = [
  {name:'COMPOSIO_REMOTE_WORKBENCH',description:'Run Python in this user’s persistent Composio sandbox for calculations and research artifacts. Never use it for signing, transactions, messaging, or bypassing tool permissions. Use inline market evidence when sufficient.',inputSchema:{type:'object',properties:{code_to_execute:{type:'string',maxLength:24000},thought:{type:'string',maxLength:500},current_step:{type:'string',maxLength:100},current_step_metric:{type:'string',maxLength:100}},required:['code_to_execute'],additionalProperties:false}},
  {name:'COMPOSIO_REMOTE_BASH_TOOL',description:'Run a bounded shell command in this user’s Composio research sandbox. Files and state are private to this user. Do not send messages, sign transactions, or modify connected services.',inputSchema:{type:'object',properties:{command:{type:'string',maxLength:8000}},required:['command'],additionalProperties:false}},
].map(tool=>({...tool,annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}}));

export function validateComposioBinding(value) {
  return object(value) && /^[A-Za-z0-9_-]{1,128}$/.test(value.userId ?? '') &&
    /^ca_[A-Za-z0-9_-]{1,128}$/.test(value.accountId ?? '') &&
    /^ac_[A-Za-z0-9_-]{1,128}$/.test(value.authConfigId ?? '');
}

export function createComposioBroker({ env, fetchImpl, store, now }) {
  let catalogCache;
  const pending = new Map();
  async function request(path, signal, body) {
    const response = await fetchImpl('https://backend.composio.dev/api/v3.1' + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
      headers: { 'x-api-key': env.COMPOSIO_API_KEY.trim(), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) { await response.body?.cancel(); throw fail(`Composio request failed (HTTP ${response.status})`, response.status === 429 ? 429 : 502); }
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2_097_152) throw fail('Composio response exceeded 2 MB');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async function catalog(signal) {
    if (catalogCache && now() - catalogCache.at < 600_000) return catalogCache.tools;
    // Retrieve exact versions individually: no implicit latest-version upgrades.
    const tools = [];
    for (const slug of SOLGPT_TOOLS) {
      const tool = await request(`/tools/${slug}?version=${SOLGPT_VERSION}`, signal);
      if (tool.slug !== slug || tool.version !== SOLGPT_VERSION || tool.toolkit?.slug?.toLowerCase() !== SOLGPT_TOOLKIT || !object(tool.input_parameters)) throw fail('Unexpected SOLgpt tool version or schema');
      tools.push({ name: slug, description: String(tool.description ?? '').slice(0, 3000), inputSchema: tool.input_parameters,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } });
    }
    catalogCache = { at: now(), tools }; return tools;
  }
  async function account(user, signal) {
    const binding = user.composio;
    if (!validateComposioBinding(binding)) throw fail('SOLgpt connection has not been provisioned for this user', 409);
    const item = await request(`/connected_accounts/${binding.accountId}`, signal);
    // Never use a connection merely because it exists in the operator project.
    if (item.user_id !== binding.userId || item.toolkit?.slug !== SOLGPT_TOOLKIT ||
        (item.auth_config?.id ?? item.auth_config_id) !== binding.authConfigId) throw fail('SOLgpt connection ownership mismatch', 403);
    if (item.status !== 'ACTIVE') throw fail('SOLgpt connection is not active', 409);
    return binding;
  }
  async function session(user, signal) {
    const binding = await account(user, signal);
    const fingerprint = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
    const saved = store.composioSession(user.id, fingerprint);
    if (saved) return saved;
    if (pending.has(user.id)) return pending.get(user.id);
    const creation = (async () => {
      const result = await request('/tool_router/session', signal, {
        user_id: binding.userId, toolkits: { enable: [SOLGPT_TOOLKIT] },
        auth_configs: { [SOLGPT_TOOLKIT]: binding.authConfigId },
        connected_accounts: { [SOLGPT_TOOLKIT]: [binding.accountId] },
        tools: { [SOLGPT_TOOLKIT]: { enable: SOLGPT_TOOLS } },
        manage_connections: { enable: false },
        sandbox: { enable: true, sandbox_size: 'standard', enable_proxy_execution: false },
        mcp: true,
      });
      if (!/^trs_[A-Za-z0-9_-]+$/.test(result.session_id ?? '') || result.config?.user_id !== binding.userId) throw fail('Invalid Composio session');
      // Session credentials/URLs are retained by Composio. Only the ID is stored.
      store.bindComposioSession(user.id, fingerprint, result.session_id);
      return result.session_id;
    })();
    pending.set(user.id, creation);
    try { return await creation; } finally { pending.delete(user.id); }
  }
  return async function handle({ path, body, user, signal }) {
    if (path === '/composio/v1/catalog') return { items: [{ slug: SOLGPT_TOOLKIT, name: 'SOLgpt', description: 'Solana market research, prices, charts and wallet data', version: SOLGPT_VERSION }] };
    if (path.startsWith('/composio/v1/connectors')) {
      const binding = await account(user, signal);
      return { services: { [SOLGPT_TOOLKIT]: { connected: true, status: 'ACTIVE', accounts: [{ id: binding.accountId, status: 'ACTIVE' }] } } };
    }
    if (path === '/composio/v1/session') { await session(user, signal); return { ready: true, toolkit: SOLGPT_TOOLKIT, toolVersion: SOLGPT_VERSION, sandbox: 'standard' }; }
    if (!object(body) || body.jsonrpc !== '2.0') throw fail('Invalid MCP request', 400);
    const id = body.id ?? null;
    if (body.method === 'initialize') return reply(id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'clawd-solgpt', version: SOLGPT_VERSION } });
    if (body.method === 'notifications/initialized') return null;
    if (body.method === 'ping') return reply(id, {});
    if (body.method === 'tools/list') return reply(id, { tools: [...await catalog(signal), ...(user.services?.includes('sandbox') ? SANDBOX_TOOLS : [])] });
    if (body.method === 'tools/call' && SANDBOX_TOOLS.some(tool => tool.name === body.params?.name)) {
      if (!user.services?.includes('sandbox')) throw fail('Sandbox is not enabled for this user',403);
      const tool = SANDBOX_TOOLS.find(tool=>tool.name===body.params.name), args=body.params.arguments;
      if(!object(args)||Object.keys(args).some(key=>!Object.hasOwn(tool.inputSchema.properties,key))||
        tool.inputSchema.required.some(key=>typeof args[key]!=='string'||!args[key].trim())||
        Object.entries(args).some(([key,value])=>typeof value!=='string'||value.length>tool.inputSchema.properties[key].maxLength)) throw fail('Invalid sandbox arguments',400);
      const sessionId=await session(user,signal);
      const output=await request(`/tool_router/session/${sessionId}/execute`,signal,{tool_slug:tool.name,arguments:args});
      const isError=output.successful===false||Boolean(output.error)||Boolean(output.data?.error)||output.data?.isError===true;
      return reply(id,{isError,content:[{type:'text',text:isError?'Remote sandbox execution failed.':JSON.stringify(output.data)}]});
    }
    if (body.method !== 'tools/call' || !SOLGPT_TOOLS.includes(body.params?.name) || !object(body.params?.arguments)) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unsupported SOLgpt research tool or arguments' } };
    }
    const binding = await account(user, signal);
    const args = body.params.arguments;
    // IDs, credentials and versions come exclusively from server policy.
    if (Object.keys(args).some(key => /^(?:user_id|connected_account_id|auth_config_id|version|api_key|apiKey|headers|base_url)$/i.test(key))) throw fail('Reserved tool argument', 400);
    const result = await request(`/tools/execute/${body.params.name}`, signal, {
      user_id: binding.userId, connected_account_id: binding.accountId, version: SOLGPT_VERSION, arguments: args,
    });
    const isError = result.successful === false || Boolean(result.error) || result.data?.isError === true;
    // Do not return project diagnostics, auth metadata, or an upstream error body.
    return reply(id, { isError, content: [{ type: 'text', text: isError ? 'SOLgpt data is unavailable for this request.' : JSON.stringify({ source: 'SOLgpt via Composio', version: SOLGPT_VERSION, retrievedAt: new Date(now()).toISOString(), data: result.data }) }] });
  };
}

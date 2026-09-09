import { readFile } from 'node:fs/promises';
import { parseHostedAccessFile } from './lib/hosted-access-file.mjs';
const [clientFile, mode = 'catalog'] = process.argv.slice(2);
if (!clientFile || !['catalog', 'session', 'resolve', 'sandbox'].includes(mode)) throw new Error('Usage: check-hosted-composio.mjs CLIENT_ENV [catalog|session|resolve]');
const access = parseHostedAccessFile(await readFile(clientFile, 'utf8'));
const headers = { authorization: `Bearer ${access.token}`, 'content-type': 'application/json' };
const requests = mode === 'sandbox' ? [{path:'/composio/v1/mcp',body:{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'COMPOSIO_REMOTE_WORKBENCH',arguments:{code_to_execute:'print("CLAWD_SANDBOX_READY", sum([1, 2, 3]))'}}}}] : mode === 'catalog' ? [
  { path: '/composio/v1/connectors/connected' },
  { path: '/composio/v1/mcp', body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } },
] : mode === 'session' ? [{ path: '/composio/v1/session', body: {} }] : [{ path: '/composio/v1/mcp', body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'CUSTOM_SOLGPT_RESOLVE_TOKEN', arguments: { symbolOrMint: 'SOL' } } } }];
for (const { path, body } of requests) {
  const response = await fetch(access.url + path, { method: body ? 'POST' : 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(60000), ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  console.log(JSON.stringify({ path, status: response.status, services: result.services, ready: result.ready, toolkit: result.toolkit, toolVersion: result.toolVersion,
    tools: result.result?.tools?.map(tool => tool.name), isError: result.result?.isError,
    result: ['resolve','sandbox'].includes(mode) ? result.result?.content : undefined, error: result.error }));
  if (!response.ok || result.error || result.result?.isError) process.exitCode = 1;
}

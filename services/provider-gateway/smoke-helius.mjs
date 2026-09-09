import { readFile } from 'node:fs/promises';
const [rawOrigin, clientFile] = process.argv.slice(2);
const origin = new URL(rawOrigin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an HTTPS gateway origin');
const token = /^SAND_HOSTED_GATEWAY_TOKEN=([A-Za-z0-9_-]{32,128})$/m.exec(await readFile(clientFile, 'utf8'))?.[1];
if (!token) throw new Error('Client file lacks gateway token');
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const accountResponse = await fetch(new URL('/v1/account', origin), { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
if (!accountResponse.ok || !(await accountResponse.json()).services?.includes('helius')) throw new Error('Helius service is not enabled');
const endpoint = new URL('/helius/rpc', origin);
const unauthorized = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(15000) });
if (unauthorized.status !== 401) throw new Error('Unauthorized Helius request was not rejected');
const response = await fetch(endpoint, {
  method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(125000),
  body: JSON.stringify({ jsonrpc: '2.0', id: 'smoke', method: 'getBalance', params: ['11111111111111111111111111111111'] }),
});
if (!response.ok) throw new Error(`Helius read failed: HTTP ${response.status}`);
const body = await response.json();
if (body.error || body.id !== 'smoke' || !Number.isFinite(body.result?.value) || !Number.isSafeInteger(body.result?.context?.slot)) throw new Error('Invalid Helius balance response');
console.log('PASS: authenticated Helius read, unauthorized rejection, and per-user service discovery. No credentials printed.');

import { readFile } from 'node:fs/promises';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';
const [clientFile] = process.argv.slice(2);
const {url, token} = parseHostedAccessFile(await readFile(clientFile, 'utf8'));
const headers = {authorization: `Bearer ${token}`, 'content-type': 'application/json'};
const account = await fetch(url + '/v1/account', {headers, redirect: 'error', signal: AbortSignal.timeout(30000)});
if (!account.ok || !(await account.json()).services?.includes('birdeye')) throw new Error('Birdeye grant unavailable');
const endpoint = url + '/birdeye/request';
const unauthorized = await fetch(endpoint, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000)});
if (unauthorized.status !== 401) throw new Error('Unauthenticated request was not rejected');
const mint = 'So11111111111111111111111111111111111111112';
for (const body of [{action:'price',mints:[mint]}, {action:'overview',mint}]) {
  const response = await fetch(endpoint, {method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(30000),body:JSON.stringify(body)});
  const payload = await response.json();
  if (!response.ok) throw new Error(`Birdeye ${body.action} failed: HTTP ${response.status}, upstream ${payload.upstreamStatus ?? 'unavailable'}`);
  const price = body.action === 'price' ? payload.data?.[mint]?.value : payload.data?.price;
  if (payload.success !== true || !Number.isFinite(price) || price <= 0) throw new Error(`Invalid ${body.action} response`);
  console.log(`PASS: authenticated Birdeye ${body.action} returned a current numeric price.`);
}
console.log('PASS: Birdeye service discovery and unauthenticated rejection. No credentials printed.');

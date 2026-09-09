import { readFile } from 'node:fs/promises';
const [rawOrigin, clientFile, minimum] = process.argv.slice(2);
const origin = new URL(rawOrigin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an HTTPS gateway origin');
const token = /^SAND_HOSTED_GATEWAY_TOKEN=([A-Za-z0-9_-]{32,128})$/m.exec(await readFile(clientFile, 'utf8'))?.[1];
if (!token) throw new Error('Client file lacks gateway token');
const response = await fetch(new URL('/v1/account', origin), {
  redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${token}` },
});
if (!response.ok) throw new Error(`Account status failed: ${response.status}`);
const body = await response.json();
if (minimum !== undefined && (!Number.isSafeInteger(Number(minimum)) || body.usage?.requests < Number(minimum))) throw new Error('Persisted usage is below expected minimum');
console.log(JSON.stringify({ day: body.usage?.day, requests: body.usage?.requests, dailyRequests: body.dailyRequests }));

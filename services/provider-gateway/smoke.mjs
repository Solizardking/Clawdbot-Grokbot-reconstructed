import { readFile } from 'node:fs/promises';
const [rawOrigin, clientFile, model = 'openrouter/free', provider = 'openrouter'] = process.argv.slice(2);
if (!['openrouter','xai'].includes(provider)) throw new Error('Unsupported smoke provider');
const origin = new URL(rawOrigin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an HTTPS gateway origin');
const config = await readFile(clientFile, 'utf8');
const token = /^SAND_HOSTED_GATEWAY_TOKEN=([A-Za-z0-9_-]{32,128})$/m.exec(config)?.[1];
if (!token) throw new Error('Client file lacks a valid gateway token');
const endpoint = new URL(`/${provider}/v1/chat/completions`, origin);
const health = await fetch(new URL('/healthz', origin), { signal: AbortSignal.timeout(15_000) });
if (health.status !== 200 || (await health.json()).ok !== true) throw new Error('Health failed');
const denied = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(15_000) });
if (denied.status !== 401) throw new Error('Unauthenticated requests were not rejected');
const accountUrl = new URL('/v1/account', origin);
const accountHeaders = { authorization: `Bearer ${token}` };
const accountBeforeResponse = await fetch(accountUrl, { headers: accountHeaders, signal: AbortSignal.timeout(15_000) });
if (!accountBeforeResponse.ok) throw new Error('Authenticated account status failed');
const accountBefore = await accountBeforeResponse.json();
const response = await fetch(endpoint, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(125_000),
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 1024, stream: true }),
});
if (!response.ok) throw new Error(`Authenticated completion failed with HTTP ${response.status}`);
const body = await response.text();
if (!body.includes('data: [DONE]')) throw new Error('Stream did not finish');
const events = body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
if (events.some(event => event.error) || !events.some(event => event.choices?.some(choice => choice.delta?.content))) {
  console.error(JSON.stringify({ events: events.length, providerError: events.some(event => event.error), reasoning: events.some(event => event.choices?.some(choice => choice.delta?.reasoning)), lengthLimited: events.some(event => event.choices?.some(choice => choice.finish_reason === 'length')) }));
  throw new Error('Stream contained no completion text or reported an error');
}
const accountAfterResponse = await fetch(accountUrl, { headers: accountHeaders, signal: AbortSignal.timeout(15_000) });
if (!accountAfterResponse.ok) throw new Error('Post-completion account status failed');
const accountAfter = await accountAfterResponse.json();
if (accountBefore.usage.day === accountAfter.usage.day && accountAfter.usage.requests <= accountBefore.usage.requests) throw new Error('Completion did not advance durable usage');
console.log(`PASS: health, unauthorized rejection, authenticated stream, durable usage=${accountAfter.usage.requests}. No credentials or response content printed.`);

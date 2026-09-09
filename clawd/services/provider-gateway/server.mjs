import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

const UPSTREAMS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', key: 'OPENROUTER_API_KEY' },
  xai: { url: 'https://api.x.ai/v1/chat/completions', key: 'XAI_API_KEY' },
};
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

export function createGateway({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  // Only digests go in the server registry; each user receives their own token.
  const users = JSON.parse(env.GATEWAY_USERS_JSON || '{}');
  if (!users || Array.isArray(users) || typeof users !== 'object' || !Object.keys(users).length) throw new Error('GATEWAY_USERS_JSON must contain user token digests');
  for (const [digest, user] of Object.entries(users)) {
    if (!/^[a-f0-9]{64}$/.test(digest) || !user || typeof user.id !== 'string' || !user.id ||
        !Array.isArray(user.models) || !user.models.length || user.models.some(m => typeof m !== 'string' || !m)) {
      throw new Error('Invalid gateway user policy');
    }
  }
  if (!Object.values(UPSTREAMS).some(p => env[p.key]?.trim())) throw new Error('Configure at least one provider API key');
  const buckets = new Map();
  return createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { ok: true });
    const match = /^\/(openrouter|xai)\/v1\/chat\/completions$/.exec(req.url || '');
    if (req.method !== 'POST' || !match) return json(res, 404, { error: 'Not found' });
    const bearer = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization || '');
    const digest = bearer ? hash(bearer[1]) : '';
    const user = Object.hasOwn(users, digest) ? users[digest] : undefined;
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    const provider = UPSTREAMS[match[1]];
    if (!env[provider.key]?.trim()) return json(res, 503, { error: 'Provider unavailable' });
    let bucket = buckets.get(user.id);
    if (!bucket) { bucket = { start: now(), count: 0, active: 0 }; buckets.set(user.id, bucket); }
    if (now() - bucket.start >= 60_000) { bucket.start = now(); bucket.count = 0; }
    if (bucket.count >= 20 || bucket.active >= 2) {
      res.setHeader('retry-after', '60');
      return json(res, 429, { error: 'Request limit reached' });
    }
    bucket.count++; bucket.active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    timer.unref();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Expected application/json' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_048_576) return json(res, 413, { error: 'Request too large' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return json(res, 400, { error: 'Invalid JSON' }); }
      if (!body || Array.isArray(body) || typeof body !== 'object' || !user.models.includes(body.model) ||
          !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 256 ||
          (body.stream !== undefined && typeof body.stream !== 'boolean')) {
        return json(res, 400, { error: 'Invalid messages, stream, or disallowed model' });
      }
      // An explicit allowlist prevents provider overrides, alternate models,
      // callbacks, or credential-like fields from bypassing the user's policy.
      const outgoing = Object.fromEntries(['model', 'messages', 'stream', 'tools', 'tool_choice', 'temperature', 'top_p', 'stop', 'response_format', 'seed', 'presence_penalty', 'frequency_penalty'].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
      const requestedTokens = body.max_completion_tokens ?? body.max_tokens ?? 4096;
      if (!Number.isSafeInteger(requestedTokens) || requestedTokens < 1) return json(res, 400, { error: 'Invalid token limit' });
      outgoing.max_tokens = Math.min(requestedTokens, 4096);
      const upstream = await fetchImpl(provider.url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${env[provider.key].trim()}`, 'content-type': 'application/json' },
        body: JSON.stringify(outgoing),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return json(res, upstream.status === 429 ? 429 : 502, { error: 'Provider request failed' });
      }
      if (!upstream.body) return json(res, 502, { error: 'Empty provider response' });
      res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream' : 'application/json' });
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal });
      }
      res.end();
    } catch {
      if (!res.headersSent && !res.destroyed) json(res, controller.signal.aborted ? 504 : 502, { error: 'Gateway request failed' });
      else res.destroy();
    } finally {
      clearTimeout(timer);
      res.off('close', disconnect);
      bucket.active--;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = createGateway();
    server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('Provider gateway listening'));
    const stop = () => { server.close(); setTimeout(() => process.exit(0), 10_000).unref(); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch { console.error('Gateway configuration invalid; check provider keys and GATEWAY_USERS_JSON'); process.exitCode = 1; }
}

import { pumpRequest } from './pump.mjs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createGatewayStore } from './store.mjs';
import { heliusRequest, heliusResponse } from './helius.mjs';
import { browserUseRequest, browserUseResponse } from './browser-use.mjs';
import { e2bRequest, executeDesktop } from './e2b.mjs';
import { mediaRequest, mediaResponse } from './media.mjs';
import { createMarketService, marketRequest, MARKET_TOOLS } from './market.mjs';
import { createComposioBroker, validateComposioBinding } from './composio.mjs';
import { tavilyRequest, tavilyResponse } from './tavily.mjs';
import { birdeyeRequest, birdeyeResponse, createBirdeyeEnrichment } from './birdeye.mjs';
import { solanaTrackerEndpoint, solanaTrackerRequest } from './solana-tracker.mjs';
import { forwardRuntime } from './runtime.mjs';
import { createWalletAccessVerifier } from './wallet-access.mjs';

const UPSTREAMS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', key: 'OPENROUTER_API_KEY' },
  nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: 'NVIDIA_API_KEY' },
  novita: { url: 'https://api.novita.ai/dedicated/v1/openai/chat/completions', key: 'NOVITA_API_KEY' },
  xai: { url: 'https://api.x.ai/v1/chat/completions', key: 'XAI_API_KEY' },
};
const hash = value => createHash('sha256').update(value).digest('hex');
const first = (env, ...keys) => {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return '';
};
function normalizeGatewayEnv(raw) {
  const env = { ...raw };
  if (!env.OPENROUTER_API_KEY?.trim() && env.SOLGPT_API_KEY?.trim()) env.OPENROUTER_API_KEY = env.SOLGPT_API_KEY;
  if (!env.BROWSER_USE_API_KEY?.trim() && env.BROWSERUSE_API_KEY?.trim()) env.BROWSER_USE_API_KEY = env.BROWSERUSE_API_KEY;
  if (!env.PUMP_MCP_TOKEN?.trim() && env.SOLGPT_PUMP_MCP_TOKEN?.trim()) env.PUMP_MCP_TOKEN = env.SOLGPT_PUMP_MCP_TOKEN;
  return env;
}
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

export function createGateway({ env = process.env, fetchImpl = fetch, now = Date.now, store: suppliedStore, desktopSdk } = {}) {
  env = normalizeGatewayEnv(env);
  // Only digests go in the server registry; each user receives their own token.
  const users = JSON.parse(env.GATEWAY_USERS_JSON || '{}');
  const walletAccess = createWalletAccessVerifier(env, now);
  const browserModel = env.BROWSER_USE_MODEL || 'gpt-5.6-luna';
  if (!['gpt-5.6-luna', 'grok-4.5'].includes(browserModel)) throw new Error('Unsupported hosted Browser Use model');
  if (!users || Array.isArray(users) || typeof users !== 'object' || !Object.keys(users).length) throw new Error('GATEWAY_USERS_JSON must contain user token digests');
  const runtimeOwners = new Map();
  const composioOwners = new Map();
  for (const [digest, user] of Object.entries(users)) {
    if (!/^[a-f0-9]{64}$/.test(digest) || !user || typeof user.id !== 'string' || !user.id ||
        !Array.isArray(user.models) || !user.models.length || user.models.some(m => typeof m !== 'string' || !m) ||
        (user.dailyRequests !== undefined && (!Number.isSafeInteger(user.dailyRequests) || user.dailyRequests < 1)) ||
        (user.services !== undefined && (!Array.isArray(user.services) || user.services.some(service => !['helius', 'browseruse', 'e2b', 'media', 'birdeye', 'tavily', 'composio', 'market', 'pump', 'sandbox', 'solana'].includes(service))))) {
      throw new Error('Invalid gateway user policy');
    }
    if (user.composio !== undefined && !validateComposioBinding(user.composio)) throw new Error('Invalid Composio binding');
    if (user.composio) {
      for (const identity of [user.composio.userId, user.composio.accountId]) {
        if (composioOwners.has(identity) && composioOwners.get(identity) !== user.id) throw new Error('Private Composio connections cannot be shared between users');
        composioOwners.set(identity, user.id);
      }
    }
    if (user.runtimeApp !== undefined) {
      if (typeof user.runtimeApp !== 'string' || !/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(user.runtimeApp)) throw new Error('Invalid runtime app');
      const owner = runtimeOwners.get(user.runtimeApp);
      if (owner && owner !== user.id) throw new Error('A runtime cannot be shared between users');
      runtimeOwners.set(user.runtimeApp, user.id);
    }
    if (user.chatModels !== undefined && (!user.chatModels || typeof user.chatModels !== 'object' || Array.isArray(user.chatModels) ||
      Object.entries(user.chatModels).some(([provider, models]) => !Object.hasOwn(UPSTREAMS, provider) || !Array.isArray(models) || models.some(model => !user.models.includes(model))))) {
      throw new Error('Invalid gateway chat model catalog');
    }
  }
  if (!Object.values(UPSTREAMS).some(p => env[p.key]?.trim())) throw new Error('Configure at least one provider API key');
  if (!suppliedStore && !env.GATEWAY_DATABASE_PATH) throw new Error('GATEWAY_DATABASE_PATH is required');
  if (env.NODE_ENV === 'production' && env.GATEWAY_DATABASE_PATH === ':memory:') throw new Error('Production requires persistent account storage');
  const store = suppliedStore || createGatewayStore(env.GATEWAY_DATABASE_PATH);
  const marketService = createMarketService({ fetchImpl, now });
  const enrichBirdeye = createBirdeyeEnrichment({ fetchImpl, now, apiKey:env.BIRDEYE_API_KEY });
  const composioBroker = createComposioBroker({ env, fetchImpl, store, now });
  const buckets = new Map();
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.method === 'GET' && req.url === '/healthz') {
      try { store.usage('__health__', now()); return json(res, 200, { ok: true }); }
      catch { return json(res, 503, { ok: false }); }
    }
    const match = /^\/(openrouter|xai|novita|nvidia)\/v1\/chat\/completions$/.exec(req.url || '');
    const catalog = req.method === 'GET' ? /^\/(openrouter|xai|novita|nvidia)\/v1\/models$/.exec(req.url || '') : null;
    const account = req.method === 'GET' && req.url === '/v1/account';
    const runtime = req.method === 'GET' && req.url === '/v1/runtime';
    const runtimeRequest = (req.method === 'GET' && /^\/(health|events|avatars\/[^?]+|local-exec\/requests|webauthn\/requests)(?:\?.*)?$/.test(req.url || ''))
      || (req.method === 'POST' && /^\/(api\/[A-Za-z][A-Za-z0-9_]*|local-exec\/responses|webauthn\/responses|prepare-upgrade)$/.test(req.url || ''));
    const pump = req.method === 'POST' && req.url === '/pump/mcp';
    const market = req.method === 'POST' && ['/market/request','/market/mcp'].includes(req.url);
    const composio = (req.method === 'POST' && ['/composio/v1/mcp', '/composio/v1/session'].includes(req.url)) ||
      (req.method === 'GET' && /^\/composio\/v1\/(catalog|connectors(?:\/connected)?)(?:\?services=[A-Za-z0-9_,%+-]*)?$/.test(req.url || ''));
    const tavily = req.method === 'POST' && req.url === '/tavily/mcp';
    const birdeye = req.method === 'POST' && req.url === '/birdeye/request';
    const trackerRpc = req.method === 'POST' && req.url === '/solana/rpc';
    const rpc = trackerRpc || (req.method === 'POST' && req.url === '/helius/rpc');
    const browser = req.method === 'POST' && req.url === '/browseruse/request';
    const media = req.method === 'POST' ? /^\/openrouter\/v1(\/images|\/audio\/speech|\/audio\/transcriptions)$/.exec(req.url || '') : null;
    const desktop = req.method === 'POST' && req.url === '/e2b/request';
    if (!pump && !market && !composio && !tavily && !catalog && !account && !runtime && !runtimeRequest && !birdeye && !rpc && !browser && !desktop && !media && (req.method !== 'POST' || !match)) return json(res, 404, { error: 'Not found' });
    const bearer = /^Bearer ([A-Za-z0-9_.-]{32,4096})$/.exec(req.headers.authorization || '');
    const digest = bearer ? hash(bearer[1]) : '';
    const user = Object.hasOwn(users, digest) ? users[digest] : await walletAccess(bearer?.[1]);
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    if (catalog) {
      const provider = catalog[1];
      const models = env[UPSTREAMS[provider].key]?.trim() ? user.chatModels?.[provider] ?? [] : [];
      return json(res, 200, { object: 'list', data: [...new Set(models)].map(id => ({ id, name: id, object: 'model', owned_by: provider })) });
    }
    if (runtime) return user.runtimeApp
      ? json(res, 200, { transport: 'gateway' })
      : json(res, 404, { error: 'No computer provisioned for this user' });
    if (runtimeRequest) {
      if (!user.runtimeApp) return json(res, 404, { error: 'No computer provisioned for this user' });
      return forwardRuntime(req, res, user.runtimeApp, fetchImpl);
    }
    if (account) {
      try { return json(res, 200, { id: user.id, models: user.models, services: (user.services ?? []).filter(service => (service === 'sandbox' && env.COMPOSIO_API_KEY?.trim() && user.services?.includes('composio')) || (service === 'pump' && env.PUMP_MCP_TOKEN?.trim()) || service === 'market' || (service === 'solana' && solanaTrackerEndpoint(env)) || (service === 'composio' && env.COMPOSIO_API_KEY?.trim()) || (service === 'tavily' && env.TAVILY_API_KEY?.trim()) || (service === 'birdeye' && env.BIRDEYE_API_KEY?.trim()) || (service === 'helius' && first(env, 'HELIUS_RPC_URL', 'HELIUS_API_KEY')) || (service === 'browseruse' && env.BROWSER_USE_API_KEY?.trim()) || (service === 'e2b' && env.E2B_API_KEY?.trim()) || (service === 'media' && env.OPENROUTER_API_KEY?.trim())), dailyRequests: user.dailyRequests ?? 200, usage: store.usage(user.id, now()) }); }
      catch { return json(res, 503, { error: 'Account storage unavailable' }); }
    }
    if (pump && !user.services?.includes('pump')) return json(res, 403, { error: 'Service not enabled for this user' });
    if (market && !user.services?.includes('market')) return json(res, 403, { error: 'Service not enabled for this user' });
    if (composio && !user.services?.includes('composio')) return json(res, 403, { error: 'Service not enabled for this user' });
    if (tavily && !user.services?.includes('tavily')) return json(res, 403, { error: 'Service not enabled for this user' });
    if (birdeye && !user.services?.includes('birdeye')) return json(res, 403, { error: 'Service not enabled for this user' });
    if (rpc && !user.services?.includes(trackerRpc ? 'solana' : 'helius')) return json(res, 403, { error: 'Service not enabled for this user' });
    if (browser && !user.services?.includes('browseruse')) return json(res, 403, { error: 'Service not enabled for this user' });
    if (desktop && !user.services?.includes('e2b')) return json(res, 403, { error: 'Service not enabled for this user' });
    if (media && !user.services?.includes('media')) return json(res, 403, { error: 'Service not enabled for this user' });
    const heliusRpcUrl = env.HELIUS_RPC_URL?.trim() || (env.HELIUS_API_KEY?.trim() ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY.trim())}` : '');
    const provider = trackerRpc ? { url: solanaTrackerEndpoint(env), key: 'SOLANA_TRACKER_RPC_URL' } : pump ? {key:'PUMP_MCP_TOKEN'} : market ? {} : composio ? {key:'COMPOSIO_API_KEY'} : tavily ? {url:'https://api.tavily.com',key:'TAVILY_API_KEY'} : birdeye ? { url: 'https://public-api.birdeye.so', key: 'BIRDEYE_API_KEY' } : media ? { url: 'https://openrouter.ai/api/v1' + media[1], key: 'OPENROUTER_API_KEY' } : desktop ? { key: 'E2B_API_KEY' } : browser ? { url: 'https://api.browser-use.com/api/v4', key: 'BROWSER_USE_API_KEY' } : rpc ? { url: heliusRpcUrl, key: 'HELIUS_API_KEY' } : UPSTREAMS[match[1]];
    if (trackerRpc || rpc ? !provider.url : (!market && !env[provider.key]?.trim())) return json(res, 503, { error: 'Provider unavailable' });
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
      if (req.method !== 'GET' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Expected application/json' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (media?.[1] === "/audio/transcriptions" ? 8_388_608 : 1_048_576)) return json(res, 413, { error: 'Request too large' });
        chunks.push(chunk);
      }
      let body;
      try { body = req.method === 'GET' ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return json(res, 400, { error: 'Invalid JSON' }); }
      if (pump) {
        if (body?.method === 'tools/call' && !store.reserve(user.id, now(), user.dailyRequests ?? 200)) return json(res, 429, { error: 'Daily request allowance reached' });
        const result = await pumpRequest(body, { fetchImpl, apiKey: env.PUMP_MCP_TOKEN.trim(), signal: controller.signal });
        return json(res, result === null ? 202 : 200, result);
      }
      if (market) {
        const isMcp = req.url === '/market/mcp';
        if (isMcp) {
          if (!body || body.jsonrpc !== '2.0') return json(res,400,{error:'Invalid MCP request'});
          const result = value => json(res,200,{jsonrpc:'2.0',id:body.id??null,result:value});
          if (body.method === 'initialize') return result({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'clawd-markets',version:'1.0.0'}});
          if (body.method === 'tools/list') return result({tools:MARKET_TOOLS});
          if (body.method === 'ping') return result({});
          if (body.method === 'notifications/initialized') return json(res,202,null);
          if (body.method !== 'tools/call' || !['market_search','market_snapshot'].includes(body.params?.name)) return json(res,400,{error:'Unsupported market tool'});
        }
        const parsed = marketRequest(isMcp ? {...body.params?.arguments, action:body.params.name === 'market_search' ? 'search' : 'snapshot'} : body);
        if (!parsed) return json(res, 400, { error: 'Invalid market request' });
        if (!store.reserve(user.id, now(), user.dailyRequests ?? 200)) return json(res, 429, { error: 'Daily request allowance reached' });
        try {
          let data = await marketService(parsed, controller.signal);
          if(user.services?.includes('birdeye'))data=await enrichBirdeye(data,controller.signal);
          return json(res, 200, isMcp ? {jsonrpc:'2.0',id:body.id??null,result:{isError:false,content:[{type:'text',text:JSON.stringify(data)}]}} : data);
        }
        catch(error) { if(env.NODE_ENV==='production')console.warn(JSON.stringify({event:'market_failure',action:parsed.action,status:error.status??502,message:error.message})); return json(res, [404,429].includes(error.status) ? error.status : 502, { error: 'Market data unavailable. Try another asset or retry later.' }); }
      }
      if (composio) {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Invalid Composio request' });
        if ((body.method === 'tools/call' || req.url === '/composio/v1/session') && !store.reserve(user.id, now(), user.dailyRequests ?? 200)) return json(res, 429, { error: 'Daily request allowance reached' });
        try {
          const result = await composioBroker({ path: req.url, body, user, signal: controller.signal });
          return json(res, result === null ? 202 : 200, result);
        } catch (error) { return json(res, [400,403,409,429].includes(error.status) ? error.status : 502, { error: error.message?.startsWith('Composio request failed') ? error.message : 'SOLgpt connection or request unavailable' }); }
      }
      let outgoing;
      if (tavily) {
        outgoing = tavilyRequest(body);
        if (!outgoing) return json(res, 400, {error:'Invalid hosted web request'});
        if (outgoing.kind === 'reply') return json(res, outgoing.status, outgoing.body);
      } else if (birdeye) {
        outgoing = birdeyeRequest(body);
        if (!outgoing) return json(res, 400, { error: 'Invalid market data request' });
      } else if (media) {
        outgoing = mediaRequest(media[1], body, user);
        if (!outgoing) return json(res, 400, { error: 'Invalid media request or disallowed model' });
      } else if (desktop) {
        try { outgoing = e2bRequest(body); }
        catch { return json(res, 400, { error: 'Invalid desktop request' }); }
      } else if (browser) {
        try { outgoing = browserUseRequest(body, user, store, browserModel); }
        catch (error) { return json(res, [400, 404].includes(error.status) ? error.status : 503, { error: [400, 404].includes(error.status) ? error.message : 'Resource storage unavailable' }); }
      } else if (rpc) {
        outgoing = trackerRpc ? solanaTrackerRequest(body) : heliusRequest(body);
        if (!outgoing) return json(res, 400, { error: 'Invalid or unsupported read-only RPC request' });
      } else {
      if (!body || Array.isArray(body) || typeof body !== 'object' || !user.models.includes(body.model) ||
          !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 256 ||
          (body.stream !== undefined && typeof body.stream !== 'boolean')) {
        return json(res, 400, { error: 'Invalid messages, stream, or disallowed model' });
      }
      // Catalog grants are provider-specific; a model allowed on one upstream
      // cannot spend another upstream credential. New NVIDIA access always
      // requires an explicit catalog, including for legacy policies.
      if ((user.chatModels !== undefined || match[1] === 'nvidia') && !user.chatModels?.[match[1]]?.includes(body.model)) {
        return json(res, 403, { error: 'Model not enabled for this provider' });
      }
      // An explicit allowlist prevents provider overrides, alternate models,
      // callbacks, or credential-like fields from bypassing the user's policy.
      outgoing = Object.fromEntries(['model', 'messages', 'stream', 'tools', 'tool_choice', 'temperature', 'top_p', 'stop', 'response_format', 'seed', 'presence_penalty', 'frequency_penalty'].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
      const requestedTokens = body.max_completion_tokens ?? body.max_tokens ?? 4096;
      if (!Number.isSafeInteger(requestedTokens) || requestedTokens < 1) return json(res, 400, { error: 'Invalid token limit' });
      outgoing.max_tokens = Math.min(requestedTokens, 4096);
      if (body.reasoning !== undefined) {
        const reasoning = body.reasoning;
        if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning) ||
            Object.keys(reasoning).some(key => !['enabled','exclude','effort','max_tokens'].includes(key)) ||
            ['enabled','exclude'].some(key => reasoning[key] !== undefined && typeof reasoning[key] !== 'boolean') ||
            (reasoning.effort !== undefined && !['none','minimal','low','medium','high','xhigh','max'].includes(reasoning.effort)) ||
            (reasoning.max_tokens !== undefined && (!Number.isSafeInteger(reasoning.max_tokens) || reasoning.max_tokens < 1 || reasoning.max_tokens >= outgoing.max_tokens))) {
          return json(res, 400, { error: 'Invalid reasoning options' });
        }
        outgoing.reasoning = reasoning;
      }
      if (match[1] === 'nvidia') {
        // Nemotron uses its own template controls, not OpenRouter's map.
        // Default to normal chat so a short reply cannot spend the entire
        // bounded output budget on reasoning. Raw template overrides are ignored.
        const reasoning = outgoing.reasoning;
        if (reasoning?.effort !== undefined && !['none', 'low', 'high'].includes(reasoning.effort)) return json(res, 400, { error: 'Unsupported NVIDIA reasoning effort' });
        const enabled = reasoning?.enabled ?? (reasoning?.effort !== undefined && reasoning.effort !== 'none');
        outgoing.chat_template_kwargs = { enable_thinking: enabled && reasoning?.effort !== 'none', ...(enabled && reasoning?.effort === 'low' ? { low_effort: true } : {}), ...(enabled && reasoning?.max_tokens !== undefined ? { reasoning_budget: reasoning.max_tokens } : {}) };
        delete outgoing.reasoning;
      }
      if (body.stream_options !== undefined) {
        if (!body.stream_options || typeof body.stream_options !== 'object' || Array.isArray(body.stream_options) ||
            Object.keys(body.stream_options).some(key => key !== 'include_usage') || typeof body.stream_options.include_usage !== 'boolean') return json(res, 400, { error: 'Invalid streaming options' });
        outgoing.stream_options = { include_usage: body.stream_options.include_usage };
      }
      }
      // Reserve before sending: an uncertain/failed upstream request may have
      // incurred cost, so no automatic refunds or retries reset this quota.
      let reserved;
      // Inspect and screenshots never create or extend a desktop. Viewing an
      // already bounded session must not consume the chat/action allowance.
      try { reserved = desktop && ['inspect', 'screenshot', 'stop'].includes(outgoing.action) ? true : store.reserve(user.id, now(), user.dailyRequests ?? 200); }
      catch { return json(res, 503, { error: 'Account storage unavailable' }); }
      if (!reserved) {
        res.setHeader('retry-after', String(Math.max(1, Math.ceil((Date.parse(new Date(now()).toISOString().slice(0, 10)) + 86400000 - now()) / 1000))));
        return json(res, 429, { error: 'Daily request allowance reached' });
      }
      if (desktop) {
        try { return json(res, 200, await executeDesktop(outgoing, user, store, { apiKey: env.E2B_API_KEY.trim(), now, sdk: desktopSdk })); }
        catch (error) { return json(res, [404,409].includes(error.status) ? error.status : 502, { error: [404,409].includes(error.status) ? error.message : 'Desktop provider request failed' }); }
      }
      const upstream = await fetchImpl(tavily || browser || birdeye ? provider.url + outgoing.path : provider.url, {
        method: birdeye ? 'GET' : browser ? outgoing.method : 'POST', redirect: 'error', signal: controller.signal,
        headers: birdeye ? { 'X-API-KEY': env.BIRDEYE_API_KEY.trim(), 'x-chain': 'solana', accept: 'application/json' } : browser ? { 'x-browser-use-api-key': env.BROWSER_USE_API_KEY.trim(), 'content-type': 'application/json' } : rpc ? { 'content-type': 'application/json' } : { authorization: `Bearer ${env[provider.key].trim()}`, 'content-type': 'application/json' },
        ...(birdeye ? {} : browser ? (outgoing.body === undefined ? {} : { body: JSON.stringify(outgoing.body) }) : { body: JSON.stringify(tavily ? outgoing.body : outgoing) }),
      });
      if (!upstream.ok) {
        if (env.NODE_ENV === 'production') console.warn(JSON.stringify({ event: 'provider_rejection', provider: provider.key, status: upstream.status, route: media?.[1] ?? (birdeye ? 'birdeye' : rpc ? 'rpc' : browser ? 'browser' : 'chat') }));
        await upstream.body?.cancel();
        return json(res, upstream.status === 429 ? 429 : 502, { error: 'Provider request failed', upstreamStatus: upstream.status });
      }
      if (!upstream.body) return json(res, 502, { error: 'Empty provider response' });
      if (media) {
        let result;
        try { result = await mediaResponse(upstream, media[1]); }
        catch { if (env.NODE_ENV === 'production') console.warn(JSON.stringify({ event: 'invalid_media_response', route: media[1] })); throw new Error('Invalid media response'); }
        res.writeHead(200, { 'content-type': result.type });
        return res.end(result.bytes);
      }
      if (tavily) return json(res, 200, await tavilyResponse(upstream, outgoing));
      if (birdeye) return json(res, 200, await birdeyeResponse(upstream, outgoing));
      if (browser) return json(res, 200, await browserUseResponse(upstream, outgoing, user, store));
      if (rpc) return json(res, 200, await heliusResponse(upstream, outgoing.id));
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
  if (!suppliedStore) server.once('close', () => store.close());
  return server;
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

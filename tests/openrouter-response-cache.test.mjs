import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build, transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadTransformedModule(relativeSource) {
  const source = await readFile(path.join(repoRoot, relativeSource), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

async function loadBundledModule(relativeSource) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "openrouter-cache-"));
  const output = path.join(temporary, "bundled.mjs");
  await build({ entryPoints: [path.join(repoRoot, relativeSource)], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("cache TTL clamps to the documented 1–86400 range and headers follow the toggle", async () => {
  const shared = await loadTransformedModule("source/shared/open-router-cache.ts");
  assert.equal(shared.clampOpenRouterCacheTtl(0), 1);
  assert.equal(shared.clampOpenRouterCacheTtl(999999), 86400);
  assert.equal(shared.clampOpenRouterCacheTtl(60.9), 60);
  assert.equal(shared.clampOpenRouterCacheTtl("600"), undefined);
  assert.deepEqual(shared.openRouterCacheHeaders(false, 600), {});
  assert.deepEqual(shared.openRouterCacheHeaders(true), { "X-OpenRouter-Cache": "true" });
  assert.deepEqual(shared.openRouterCacheHeaders(true, 600), { "X-OpenRouter-Cache": "true", "X-OpenRouter-Cache-TTL": "600" });
});

test("router metadata parses from JSON bodies and final SSE chunks", async () => {
  const shared = await loadTransformedModule("source/shared/open-router-cache.ts");
  const jsonBody = JSON.stringify({ id: "gen-1", choices: [], openrouter_metadata: { requested: "openrouter/free", strategy: "free", attempt: 1 } });
  assert.deepEqual(shared.parseOpenRouterMetadataFromText(jsonBody, "application/json"), { requested: "openrouter/free", strategy: "free", attempt: 1 });

  const sseBody = [
    'data: {"id":"gen-2","choices":[{"delta":{"content":"Hi"}}]}',
    "",
    'data: {"id":"gen-2","choices":[],"openrouter_metadata":{"requested":"openrouter/free","strategy":"alias","attempt":2,"endpoints":{"total":3,"available":[{"provider":"Chutes","model":"deepseek/deepseek-r1:free","selected":true},{"provider":"OpenAI","selected":false}]}}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const metadata = shared.parseOpenRouterMetadataFromText(sseBody, "text/event-stream");
  assert.equal(metadata.strategy, "alias");

  assert.equal(shared.parseOpenRouterMetadataFromText('{"nope":true}', "application/json"), null);
  assert.equal(shared.parseOpenRouterMetadataFromText("not json", "text/event-stream"), null);

  const route = shared.summarizeOpenRouterRoute(metadata, "MISS");
  assert.equal(route.providerName, "Chutes");
  assert.equal(route.servedModel, "deepseek/deepseek-r1:free");
  assert.equal(route.requestedModel, "openrouter/free");
  assert.equal(route.attempt, 2);
  assert.equal(route.cacheStatus, "MISS");
  assert.ok(typeof route.recordedAt === "string");

  const hit = shared.summarizeOpenRouterRoute(null, "HIT");
  assert.equal(hit.cacheStatus, "HIT");
  assert.equal(hit.providerName, null);
  const unknownHeader = shared.summarizeOpenRouterRoute(null, "WEIRD");
  assert.equal(unknownHeader.cacheStatus, null);
});

function headerRecorder(response) {
  const seen = [];
  const impl = async (url, init) => {
    seen.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers ?? []).entries()) });
    return typeof response === "function" ? await response(url, init) : response.clone();
  };
  impl.seen = seen;
  return impl;
}

test("instrumentation preserves Request credentials and leaves foreign requests untouched", async () => {
  const shared = await loadTransformedModule("source/shared/open-router-cache.ts");
  const calls = [];
  const wrapped = shared.createOpenRouterInstrumentedFetch(async (input, init) => {
    calls.push({ input, init, request: new Request(input, init) });
    return new Response("{}");
  }, { cacheEnabled: false }, () => {});
  const request = new Request("https://openrouter.ai/api/v1/chat/completions", {
    headers: { authorization: "Bearer test-only", "content-type": "application/json" },
  });
  await wrapped(request);
  assert.equal(calls[0].request.headers.get("authorization"), "Bearer test-only");
  assert.equal(calls[0].request.headers.get("content-type"), "application/json");
  await wrapped(request, { headers: { authorization: "Bearer override" } });
  assert.equal(calls[1].request.headers.get("authorization"), "Bearer override");
  assert.equal(calls[1].request.headers.get("content-type"), null);
  const foreign = new Request("https://example.com", { headers: { authorization: "Bearer foreign" } });
  await wrapped(foreign);
  assert.equal(calls[2].input, foreign);
  assert.equal(calls[2].init, undefined);
  assert.equal(calls[2].request.headers.get("authorization"), "Bearer foreign");
});

test("instrumented fetch opts into caching plus metadata and captures routes without disturbing the stream", async () => {
  const shared = await loadTransformedModule("source/shared/open-router-cache.ts");
  const body = JSON.stringify({ id: "gen-9", openrouter_metadata: { requested: "openai/gpt-5.2", strategy: "direct", attempt: 1, endpoints: { available: [{ provider: "OpenAI", model: "openai/gpt-5.2", selected: true }] } } });
  const upstream = new Response(body, { status: 200, headers: { "content-type": "application/json", "x-openrouter-cache-status": "MISS" } });
  const fetchImpl = headerRecorder(upstream);
  const routes = [];
  const wrapped = shared.createOpenRouterInstrumentedFetch(fetchImpl, { cacheEnabled: true, cacheTtlSeconds: 900 }, route => routes.push(route));

  const response = await wrapped("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer x" }, body: "{}" });
  assert.equal(fetchImpl.seen[0].headers["x-openrouter-metadata"], "enabled");
  assert.equal(fetchImpl.seen[0].headers["x-openrouter-cache"], "true");
  assert.equal(fetchImpl.seen[0].headers["x-openrouter-cache-ttl"], "900");
  assert.equal(fetchImpl.seen[0].headers.authorization, "Bearer x");
  assert.equal(await response.text(), body);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(routes.length, 1);
  assert.equal(routes[0].requestedModel, "openai/gpt-5.2");
  assert.equal(routes[0].providerName, "OpenAI");
  assert.equal(routes[0].cacheStatus, "MISS");
});

test("instrumented fetch ignores foreign URLs and handles SSE streams", async () => {
  const shared = await loadTransformedModule("source/shared/open-router-cache.ts");
  const sse = 'data: {"choices":[]}\n\ndata: {"openrouter_metadata":{"requested":"m","strategy":"fallback","attempt":3}}\n\ndata: [DONE]\n\n';
  const upstream = new Response(sse, { status: 200, headers: { "content-type": "text/event-stream", "x-openrouter-cache-status": "HIT" } });
  const fetchImpl = headerRecorder(upstream);
  const routes = [];
  const wrapped = shared.createOpenRouterInstrumentedFetch(fetchImpl, { cacheEnabled: false }, route => routes.push(route));

  await wrapped("https://api.x.ai/v1/chat/completions", {});
  assert.equal(Object.keys(fetchImpl.seen[0].headers).length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(routes.length, 0);

  const response = await wrapped("https://openrouter.ai/api/v1/chat/completions", {});
  assert.equal(fetchImpl.seen[1].headers["x-openrouter-metadata"], "enabled");
  assert.equal(fetchImpl.seen[1].headers["x-openrouter-cache"], undefined);
  await response.text();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(routes.length, 1);
  assert.equal(routes[0].strategy, "fallback");
  assert.equal(routes[0].attempt, 3);
  assert.equal(routes[0].cacheStatus, "HIT");
});

test("settings persist cache options and last-route snapshots without losing usage counters", async () => {
  const loaded = await loadBundledModule("source/shared/node/settings/sand-settings-store.ts");
  const { SandSettingsStore } = loaded.module;
  try {
    const directory = await mkdtemp(path.join(os.tmpdir(), "openrouter-cache-store-"));
    try {
      const storePath = path.join(directory, "settings.json");
      const store = new SandSettingsStore(storePath);
      assert.equal(store.getInferenceRouterCacheEnabled(), false);
      assert.equal(store.getInferenceRouterCacheTtlSeconds(), 300);

      store.setInferenceRouterCacheEnabled(true);
      store.setInferenceRouterCacheTtlSeconds(1200);
      assert.equal(store.getInferenceRouterCacheEnabled(), true);
      assert.equal(store.getInferenceRouterCacheTtlSeconds(), 1200);
      store.setInferenceRouterCacheTtlSeconds(999999);
      assert.equal(store.getInferenceRouterCacheTtlSeconds(), 86400, "out-of-range TTL clamps to the documented maximum");

      store.recordInferenceUsage("openrouter", { inputTokens: 10, outputTokens: 5 });
      store.recordOpenRouterLastRoute({ requestedModel: "openrouter/free", servedModel: "deepseek/deepseek-r1:free", providerName: "Chutes", strategy: "free", attempt: 1, cacheStatus: "MISS", recordedAt: "2026-08-24T00:00:00.000Z" });
      store.recordInferenceUsage("openrouter", { inputTokens: 1, outputTokens: 1 });
      let usage = store.getInferenceRouterUsage().providers.openrouter;
      assert.equal(usage.requests, 2);
      assert.equal(usage.inputTokens, 11);
      assert.equal(usage.lastRoute.providerName, "Chutes");

      const reloaded = new SandSettingsStore(storePath);
      usage = reloaded.getInferenceRouterUsage().providers.openrouter;
      assert.equal(usage.requests, 2);
      assert.equal(usage.lastRoute.cacheStatus, "MISS");
      assert.equal(reloaded.getInferenceRouterCacheEnabled(), true);
      assert.equal(reloaded.getInferenceRouterCacheTtlSeconds(), 86400);
    } finally { await rm(directory, { recursive: true, force: true }); }
  } finally { await loaded.dispose(); }
});

test("the OpenRouter executor instruments its transport and the desktop surface exposes the cache config", async () => {
  const read = async relative => await readFile(path.join(repoRoot, relative), "utf8");
  const session = await read("source/host/extensions/inference/provider-session.ts");
  assert.match(session, /createOpenRouterInstrumentedFetch\(hostedFetch, cache, recordOpenRouterRoute\)/);
  assert.match(session, /baseURL: "https:\/\/openrouter\.ai\/api\/v1"/);
  const mainEdge = await read("source/electron-main/main-edge.ts");
  assert.match(mainEdge, /getInferenceRouterCacheEnabled/);
  assert.match(mainEdge, /getInferenceRouterCacheTtlSeconds/);
  const preload = await read("source/electron-preload/preload.ts");
  assert.match(preload, /cache\?: \{ enabled\?: boolean; ttlSeconds\?: number \}/);
});

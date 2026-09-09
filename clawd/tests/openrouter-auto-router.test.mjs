import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function load(path) {
  const { outputFiles } = await build({
    absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

const roster = await load("../source/shared/inference-router.ts");
const { createOpenRouterModelFetch } = await load("../source/shared/openrouter-model-fetch.ts");
const cache = await load("../source/shared/open-router-cache.ts");

const CHAT = "https://openrouter.ai/api/v1/chat/completions";

async function posted(fetchImpl, models, body, autoRouter) {
  const calls = [];
  const wrapped = createOpenRouterModelFetch(async (_, init) => {
    calls.push(JSON.parse(init.body));
    return new Response("{}");
  }, models, autoRouter);
  await wrapped(CHAT, { method: "POST", body: JSON.stringify(body) });
  return calls;
}

test("Auto Router primary posts openrouter/auto and never attaches a local models array", async () => {
  const mixed = ["openrouter/auto", "nvidia/nemotron-3.5-lightning:free", "poolside/laguna-s-2.1:free"];
  const calls = await posted(null, mixed, { model: mixed[0], messages: [{ role: "user", content: "Hello" }], stream: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "openrouter/auto");
  assert.equal("models" in calls[0], false);
  assert.deepEqual(calls[0].messages, [{ role: "user", content: "Hello" }]);
  assert.equal(calls[0].stream, true);
  assert.equal("plugins" in calls[0], false);
  assert.equal("session_id" in calls[0], false);
});

test("Auto Router plugin and session_id appear only when configured, with just the set fields", async () => {
  const settings = roster.resolveOpenRouterAutoRouterRequest({
    OPENROUTER_AUTO_COST_TIER: "xhigh",
    OPENROUTER_AUTO_ALLOWED_MODELS: "anthropic/*, openai/gpt-5.1",
    OPENROUTER_AUTO_EXCLUDED_MODELS: "openai/gpt-4o",
    OPENROUTER_SESSION_ID: "my-conversation-123",
  });
  assert.deepEqual(settings, {
    costTier: "xhigh",
    allowedModels: ["anthropic/*", "openai/gpt-5.1"],
    excludedModels: ["openai/gpt-4o"],
    sessionId: "my-conversation-123",
  });
  const calls = await posted(null, ["openrouter/auto"], { model: "openrouter/auto", messages: [{ role: "user", content: "Summarize" }] }, settings);
  assert.equal(calls[0].model, "openrouter/auto");
  assert.equal("models" in calls[0], false);
  assert.equal(calls[0].session_id, "my-conversation-123");
  assert.deepEqual(calls[0].plugins, [{
    id: "auto-router",
    cost_tier: "xhigh",
    allowed_models: ["anthropic/*", "openai/gpt-5.1"],
    excluded_models: ["openai/gpt-4o"],
  }]);

  const costOnly = await posted(null, ["openrouter/auto"], { model: "openrouter/auto", messages: [] }, { costTier: "low" });
  assert.deepEqual(costOnly[0].plugins, [{ id: "auto-router", cost_tier: "low" }]);
  assert.equal("session_id" in costOnly[0], false);
  assert.equal("allowed_models" in costOnly[0].plugins[0], false);
});

test("a non-auto chain of length >= 2 still sends grouped models as today", async () => {
  const models = ["nvidia/nemotron-3.5-lightning:free", "openrouter/free", "poolside/laguna-s-2.1:free", "minimax/minimax-m3:free"];
  const calls = [];
  const wrapped = createOpenRouterModelFetch(async (_, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload);
    const last = payload.models[payload.models.length - 1] === models[models.length - 1];
    return new Response("{}", { status: last ? 200 : 503 });
  }, models);
  const body = { model: models[0], messages: [{ role: "user", content: "hi" }] };
  assert.equal((await wrapped(CHAT, { method: "POST", body: JSON.stringify(body) })).status, 200);
  assert.deepEqual(calls[0].models, models.slice(0, 3));
  assert.equal(calls[0].model, models[0]);
  assert.deepEqual(calls[1].models, models.slice(3));
  assert.equal(calls[1].model, models[3]);
});

test("last-route snapshot records Auto Router served model from the response model field", async () => {
  const body = JSON.stringify({
    id: "gen-auto",
    model: "anthropic/claude-sonnet-4.5",
    choices: [{ message: { role: "assistant", content: "..." } }],
    openrouter_metadata: { requested: "openrouter/auto", strategy: "auto", attempt: 1 },
  });
  const metadata = cache.parseOpenRouterMetadataFromText(body, "application/json");
  const served = cache.parseOpenRouterServedModelFromText(body, "application/json");
  const route = cache.summarizeOpenRouterRoute(metadata, "MISS", served);
  assert.equal(route.requestedModel, "openrouter/auto");
  assert.equal(route.servedModel, "anthropic/claude-sonnet-4.5");
  assert.equal(route.strategy, "auto");

  const routes = [];
  const wrapped = cache.createOpenRouterInstrumentedFetch(async () => new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", "x-openrouter-cache-status": "MISS" },
  }), { cacheEnabled: false }, routeSnapshot => routes.push(routeSnapshot));
  await (await wrapped(CHAT, { method: "POST", body: "{}" })).text();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(routes.length, 1);
  assert.equal(routes[0].requestedModel, "openrouter/auto");
  assert.equal(routes[0].servedModel, "anthropic/claude-sonnet-4.5");
});

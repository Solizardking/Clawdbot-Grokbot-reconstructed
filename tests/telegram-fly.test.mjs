import assert from "node:assert/strict";
import test from "node:test";

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.PAYBOX_ENABLED = "0";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(repoRoot, ".cache", "telegram-fly-test-server.mjs");
mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  absWorkingDir: repoRoot,
  entryPoints: [path.join(repoRoot, "source", "services", "telegram-fly", "server.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  outfile,
  logLevel: "silent",
});
const { createHeadlessTurnRunner, resolveHeadlessModel, resolveHeadlessModelChain, resolveHeadlessProvider } = await import(`file://${outfile}`);

const jsonResponse = payload => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

function completion(message) {
  return { id: "chatcmpl-1", choices: [{ index: 0, message }] };
}

test("headless turn runner answers directly when no tools are called", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return jsonResponse(completion({ content: "Hello from the router." }));
  };
  const runTurn = createHeadlessTurnRunner({ provider: "openrouter", apiKey: "k", models: ["openrouter/free"], fetchImpl });
  const reply = await runTurn("A Telegram user named Ada sends:\n\nhi");
  assert.equal(reply, "Hello from the router.");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requests[0].body.model, "openrouter/free");
  assert.equal(requests[0].headers["HTTP-Referer"], "https://solanaclawd.com");
  assert.equal(requests[0].headers["X-OpenRouter-Title"], "SolanaClawd");
  assert.equal(requests[0].headers["X-OpenRouter-Categories"], "personal-agent,general-chat");

  process.env.SAND_OPENROUTER_REFERER = "https://custom.example";
  try {
    requests.length = 0;
    await runTurn("again");
    assert.equal(requests[0].headers["HTTP-Referer"], "https://custom.example", "env override wins");
  } finally {
    delete process.env.SAND_OPENROUTER_REFERER;
  }
});

test("headless turn runner executes web_fetch tool calls then answers", async t => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    "<html><title>Example Page</title><body><p>Useful facts live here.</p></body></html>",
    { status: 200, headers: { "content-type": "text/html" } },
  );
  t.after(() => { globalThis.fetch = realFetch; });

  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    if (requests.length === 1) {
      return jsonResponse(completion({ content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "web_fetch", arguments: JSON.stringify({ url: "https://example.com/facts" }) } }] }));
    }
    return jsonResponse(completion({ content: "Here is what I found." }));
  };
  const runTurn = createHeadlessTurnRunner({ provider: "xai", apiKey: "k", models: ["grok-4.6"], fetchImpl });
  const reply = await runTurn("What lives here? https://example.com/facts");
  assert.equal(reply, "Here is what I found.");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://api.x.ai/v1/chat/completions");
  const assistant = requests[1].body.messages.find(message => message.role === "assistant");
  assert.ok(assistant.tool_calls.length === 1);
  const toolResult = requests[1].body.messages.find(message => message.role === "tool");
  assert.equal(toolResult.tool_call_id, "call_1");
  const parsed = JSON.parse(toolResult.content);
  assert.equal(parsed.ok, true);
  assert.match(parsed.text, /Useful facts live here\./);
});

test("headless turn runner reports missing credentials clearly", async () => {
  const original = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const runTurn = createHeadlessTurnRunner({ provider: "openrouter", fetchImpl: async () => { throw new Error("should not fetch"); } });
    await assert.rejects(runTurn("hi"), /OpenRouter needs OPENROUTER_API_KEY/);
  } finally {
    if (original != null) process.env.OPENROUTER_API_KEY = original;
  }
});

test("provider and model resolution follows env overrides", () => {
  assert.equal(resolveHeadlessProvider({}), "openrouter");
  assert.equal(resolveHeadlessProvider({ XAI_API_KEY: "x" }), "xai");
  assert.equal(resolveHeadlessProvider({ XAI_API_KEY: "x", OPENROUTER_API_KEY: "o" }), "openrouter");
  assert.equal(resolveHeadlessProvider({ TELEGRAM_ROUTER_PROVIDER: "xai", OPENROUTER_API_KEY: "o" }), "xai");
  assert.equal(resolveHeadlessModel("openrouter", {}), "nvidia/nemotron-3-ultra-550b-a55b:free");
  assert.equal(resolveHeadlessModel("openrouter", { OPENROUTER_NEMO: "nvidia/nemotron-3.5-lightning:free" }), "nvidia/nemotron-3.5-lightning:free");
  assert.equal(resolveHeadlessModel("openrouter", { SAND_OPENROUTER_MODEL: "nvidia/nemotron-3.5-lightning:free" }), "nvidia/nemotron-3.5-lightning:free");
  assert.equal(resolveHeadlessModel("openrouter", { SAND_OPENROUTER_MODEL: "meta-llama/llama-3.2-3b-instruct:free", OPENROUTER_NEMO: "nvidia/nemotron-3.5-lightning:free" }), "meta-llama/llama-3.2-3b-instruct:free", "explicit SAND override wins over NEMO default");
  assert.equal(resolveHeadlessModel("openrouter", { SAND_OPENROUTER_MODEL: "nvidia/nemotron-3.5-lightning:free" }), "nvidia/nemotron-3.5-lightning:free");
  assert.equal(resolveHeadlessModel("openrouter", { OPENROUTER_GROK_MODEL: "x-ai/grok-4.6" }), "x-ai/grok-4.6");
  assert.equal(resolveHeadlessModel("xai", {}), "grok-4.6");
  assert.equal(resolveHeadlessModel("xai", { SAND_XAI_MODEL: "grok-4-fast" }), "grok-4-fast");
});

test("model chain resolution appends and dedupes fallbacks", () => {
  assert.equal(resolveHeadlessModelChain("openrouter", {}).length, 11);
  assert.deepEqual(
    resolveHeadlessModelChain("openrouter", {
      SAND_OPENROUTER_MODEL: "nvidia/nemotron-3.5-lightning:free",
      SAND_OPENROUTER_FALLBACK_MODELS: "poolside/laguna-s-2.1:free, nvidia/nemotron-3.5-lightning:free , poolside/laguna-m.1:free,,",
    }),
    ["nvidia/nemotron-3.5-lightning:free", "poolside/laguna-s-2.1:free", "poolside/laguna-m.1:free"],
  );
  assert.deepEqual(resolveHeadlessModelChain("xai", { SAND_XAI_MODEL: "grok-4.6" }), ["grok-4.6"]);
});

test("headless sends the ordered fallback roster in one upstream request", async () => {
  const requests = [];
  const models = ["nvidia/nemotron-3.5-lightning:free", "openrouter/free"];
  const runTurn = createHeadlessTurnRunner({ provider: "openrouter", apiKey: "k", models,
    fetchImpl: async (_, init) => { requests.push(JSON.parse(init.body)); return jsonResponse(completion({ content: "Fallback answers." })); },
  });
  assert.equal(await runTurn("hi"), "Fallback answers.");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].models, models);
});

test("headless turn runner surfaces the last error after the whole chain fails", async () => {
  const fetchImpl = async () => new Response("nope", { status: 503 });
  const runTurn = createHeadlessTurnRunner({ provider: "openrouter", apiKey: "k", models: ["a:free", "b:free"], fetchImpl });
  await assert.rejects(runTurn("hi"), /chat request failed/);
});

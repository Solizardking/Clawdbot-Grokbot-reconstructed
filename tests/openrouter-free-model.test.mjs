import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(repoRoot, "source/shared/inference-router.ts");

async function loadContract() {
  const source = await readFile(contractPath, "utf8");
  const { code: output } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("OpenRouter defaults to the requested Nemotron Ultra free model", async () => {
  const contract = await loadContract();
  assert.equal(contract.SAND_DEFAULT_OPENROUTER_MODEL, "nvidia/nemotron-3-ultra-550b-a55b:free");
});

test("free-model ids normalize cleanly for every documented shape", async () => {
  const { normalizeSandOpenRouterModel } = await loadContract();
  assert.equal(normalizeSandOpenRouterModel("openrouter/free"), "openrouter/free");
  assert.equal(normalizeSandOpenRouterModel("openrouter/auto"), "openrouter/auto");
  assert.equal(normalizeSandOpenRouterModel("nex-agi/nex-n2.5-mini:free"), "nex-agi/nex-n2.5-mini:free");
  assert.equal(normalizeSandOpenRouterModel("inclusionai/ling-3.0-flash-sante:free"), "inclusionai/ling-3.0-flash-sante:free");
  assert.equal(normalizeSandOpenRouterModel("nvidia/nemotron-3.5-lightning:free"), "nvidia/nemotron-3.5-lightning:free");
  assert.equal(normalizeSandOpenRouterModel("deepseek/deepseek-r1:free"), "deepseek/deepseek-r1:free");
  assert.equal(normalizeSandOpenRouterModel("meta-llama/llama-3.2-3b-instruct:free"), "meta-llama/llama-3.2-3b-instruct:free");
  assert.equal(normalizeSandOpenRouterModel("  qwen/qwen3-235b-a22b:free  "), "qwen/qwen3-235b-a22b:free");
  assert.equal(normalizeSandOpenRouterModel(""), undefined);
  assert.equal(normalizeSandOpenRouterModel("   "), undefined);
  assert.equal(normalizeSandOpenRouterModel(null), undefined);
  assert.equal(normalizeSandOpenRouterModel(42), undefined);
  assert.equal(normalizeSandOpenRouterModel("has space"), undefined);
  assert.equal(normalizeSandOpenRouterModel("a".repeat(201)), undefined);
});

test("the host resolves env override, persisted setting, then the free default", async () => {
  const source = await readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  assert.match(source, /resolveOpenRouterModelChain\(process.env, stored\)/);
  assert.match(source, /inferenceRouterModel/);
});

test("every OpenRouter request attributes usage to solanaclawd.com", async () => {
  const source = await readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  assert.doesNotMatch(source, /grok-bot-reconstructed/, "old referer must be gone");
  assert.match(source, /"HTTP-Referer": referer/);
  assert.match(source, /referer = process\.env\.SAND_OPENROUTER_REFERER\?\.trim\(\) \|\| "https:\/\/solanaclawd\.com"/);
  assert.match(source, /"X-OpenRouter-Title"/);
  assert.match(source, /"X-OpenRouter-Categories": process\.env\.SAND_OPENROUTER_CATEGORIES\?\.trim\(\) \|\| "personal-agent,general-chat"/);

  const flyServer = await readFile(path.join(repoRoot, "source/services/telegram-fly/server.ts"), "utf8");
  assert.doesNotMatch(flyServer, /grok-bot-reconstructed/, "old referer must be gone from the hosted bridge too");
  assert.match(flyServer, /envReferer\(\) \|\| "https:\/\/solanaclawd\.com"/);
  assert.match(flyServer, /"X-OpenRouter-Title": envTitle\(\) \|\| "SolanaClawd"/);
});

test("settings persist and clear a custom OpenRouter model", async () => {
  const store = await readFile(path.join(repoRoot, "source/shared/node/settings/sand-settings-store.ts"), "utf8");
  assert.match(store, /inferenceRouterModel\?: string/);
  assert.match(store, /getInferenceRouterModel\(\): string \{ return this\.load\(\)\.inferenceRouterModel \?\? SAND_DEFAULT_OPENROUTER_MODEL; \}/);
  assert.match(store, /normalizeSandOpenRouterModel\(raw\.inferenceRouterModel\)/);
});

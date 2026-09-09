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

test("the xAI provider routes through XAI_API_KEY with grok-4.6 as the default model", async () => {
  const contract = await loadContract();
  assert.ok((contract.SAND_INFERENCE_PROVIDERS).includes("xai"));
  assert.equal(contract.SAND_DEFAULT_XAI_MODEL, "grok-4.6");
  assert.ok(contract.isSandInferenceProvider("xai"));
  assert.equal(contract.isSandInferenceProvider("grok"), false);
});

test("empty router usage tracks the xAI provider", async () => {
  const contract = await loadContract();
  const usage = contract.emptySandInferenceRouterUsage();
  assert.deepEqual(usage.providers.xai, { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsedAt: null });
});

test("the provider session resolves XAI_API_KEY and targets api.x.ai with grok-4.6", async () => {
  const source = await readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  assert.match(source, /process\.env\.XAI_API_KEY\?\.trim\(\)/);
  assert.match(source, /persistedSecrets\(\)\.XAI_API_KEY\?\.trim\(\)/);
  assert.match(source, /baseURL: "https:\/\/api\.x\.ai\/v1"/);
  assert.match(source, /process\.env\.SAND_XAI_MODEL\?\.trim\(\)/);
  assert.match(source, /return SAND_DEFAULT_XAI_MODEL;/);
  assert.match(source, /provider === "xai"/);
});

test("the coordinator transcript accepts xai-routed entries", async () => {
  const source = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(source, /\["codex", "claude-code", "openrouter", "xai"\]/);
});

test("the shipped-renderer patch exposes an xAI provider card with its own key and model field", async () => {
  const source = await readFile(path.join(repoRoot, "scripts/lib/router-renderer-patch.mjs"), "utf8");
  assert.match(source, /\{value:"xai",label:"xAI"/);
  assert.match(source, /secret:"XAI_API_KEY"/);
  assert.match(source, /placeholder:s==="xai"\?"grok-4\.6":"nvidia\/nemotron-3-ultra-550b-a55b:free"/);
  assert.match(source, /\(r\.value==="openrouter"\|\|r\.value==="xai"\)\?a\.jsx\(re,\{title:"Model"/);
});

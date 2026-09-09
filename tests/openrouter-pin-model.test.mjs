import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadBundled(relativeSource) {
  const { outputFiles } = await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, relativeSource)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

test("persisting any valid OpenRouter slug through the settings store makes it the next request model", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openrouter-pin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = path.join(directory, "settings.mjs");
  await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, "source/shared/node/settings/sand-settings-store.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    logLevel: "silent",
  });
  const { SandSettingsStore } = await import(`${pathToFileURL(outfile).href}?${Date.now()}`);
  const roster = await loadBundled("source/shared/inference-router.ts");
  const { createOpenRouterModelFetch } = await loadBundled("source/shared/openrouter-model-fetch.ts");
  const store = new SandSettingsStore(path.join(directory, "settings.json"));

  const pinned = "inclusionai/ling-3.0-flash-sante:free";
  store.setInferenceRouterModel(pinned);
  assert.equal(store.getInferenceRouterModel(), pinned);
  const chain = roster.resolveOpenRouterModelChain({}, store.getInferenceRouterModel());
  assert.deepEqual(chain, [pinned]);

  const calls = [];
  const wrapped = createOpenRouterModelFetch(async (_, init) => {
    calls.push(JSON.parse(init.body));
    return new Response("{}");
  }, chain);
  await wrapped("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: chain[0], messages: [{ role: "user", content: "How many r's are in strawberry?" }] }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, pinned);
  assert.equal("models" in calls[0], false);

  store.setInferenceRouterModel("openrouter/auto");
  assert.equal(store.getInferenceRouterModel(), "openrouter/auto");
  const autoChain = roster.resolveOpenRouterModelChain({ OPENROUTER_MODEL1: "one:free" }, store.getInferenceRouterModel());
  assert.deepEqual(autoChain, ["openrouter/auto"]);
  const autoCalls = [];
  const autoFetch = createOpenRouterModelFetch(async (_, init) => {
    autoCalls.push(JSON.parse(init.body));
    return new Response("{}");
  }, autoChain, roster.resolveOpenRouterAutoRouterRequest({ OPENROUTER_AUTO_COST_TIER: "medium", OPENROUTER_SESSION_ID: "pin-session" }));
  await autoFetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: autoChain[0], messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(autoCalls[0].model, "openrouter/auto");
  assert.equal("models" in autoCalls[0], false);
  assert.equal(autoCalls[0].session_id, "pin-session");
  assert.deepEqual(autoCalls[0].plugins, [{ id: "auto-router", cost_tier: "medium" }]);

  store.setInferenceRouterModel("nex-agi/nex-n2.5-mini:free");
  assert.equal(store.getInferenceRouterModel(), "nex-agi/nex-n2.5-mini:free");
});

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
  const temporary = await mkdtemp(path.join(os.tmpdir(), "agent-customization-"));
  const output = path.join(temporary, "bundled.mjs");
  await build({ entryPoints: [path.join(repoRoot, relativeSource)], outfile: output, bundle: true, format: "esm", platform: "node", target: "node22" });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("customization text sanitizes control characters and clamps to limits", async () => {
  const shared = await loadTransformedModule("source/shared/agent-customization.ts");
  assert.equal(shared.sanitizeSandAgentCustomizationText("Nova\u0007X", 60), "NovaX");
  assert.equal(shared.sanitizeSandAgentCustomizationText("a\tb\nc", 60), "a\tb\nc");
  assert.equal(shared.sanitizeSandAgentCustomizationText("x".repeat(99), 60).length, 60);
  assert.equal(shared.sanitizeSandAgentCustomizationText(42, 60), "");
});

test("normalization drops empty customizations and keeps meaningful fields", async () => {
  const shared = await loadTransformedModule("source/shared/agent-customization.ts");
  assert.equal(shared.normalizeSandAgentCustomization(null), undefined);
  assert.equal(shared.normalizeSandAgentCustomization("nope"), undefined);
  assert.equal(shared.normalizeSandAgentCustomization({ displayName: "   ", persona: "", customInstructions: "\u0000" }), undefined);
  const value = shared.normalizeSandAgentCustomization({ displayName: " Nova ", persona: "Dry wit", junk: "ignored" });
  assert.deepEqual(value, { displayName: "Nova", persona: "Dry wit" });
});

test("prompt block composes name, persona, and standing instructions", async () => {
  const shared = await loadTransformedModule("source/shared/agent-customization.ts");
  assert.equal(shared.composeSandAgentCustomizationPromptBlock(undefined), "");
  assert.equal(shared.composeSandAgentCustomizationPromptBlock({}), "");
  const block = shared.composeSandAgentCustomizationPromptBlock({
    displayName: "Nova",
    persona: "Terse pirate",
    customInstructions: "Sign off with ⚓\nNever use emoji elsewhere",
  });
  assert.match(block, /calls you "Nova"/);
  assert.match(block, /personality and voice.*Terse pirate/s);
  assert.match(block, /Standing instructions[\s\S]*Sign off with ⚓\nNever use emoji elsewhere/);
});

test("settings store persists agent customization and clears it on empty saves", async () => {
  const loaded = await loadBundledModule("source/shared/node/settings/sand-settings-store.ts");
  const { SandSettingsStore } = loaded.module;
  try {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-customization-store-"));
    try {
      const store = new SandSettingsStore(path.join(directory, "settings.json"));
      assert.equal(store.getAgentCustomization(), undefined);

      store.setAgentCustomization({ displayName: "Nova", persona: "Warm, concise", customInstructions: "" });
      assert.deepEqual(store.getAgentCustomization(), { displayName: "Nova", persona: "Warm, concise" });

      const reloaded = new SandSettingsStore(path.join(directory, "settings.json"));
      assert.deepEqual(reloaded.getAgentCustomization(), { displayName: "Nova", persona: "Warm, concise" });

      reloaded.setAgentCustomization(undefined);
      assert.equal(reloaded.getAgentCustomization(), undefined);
      reloaded.setAgentCustomization({ displayName: "  " });
      assert.equal(reloaded.getAgentCustomization(), undefined);
    } finally { await rm(directory, { recursive: true, force: true }); }
  } finally { await loaded.dispose(); }
});

test("desktop RPC surface wires get/set agent customization end to end", async () => {
  const read = async relative => await readFile(path.join(repoRoot, relative), "utf8");
  const methodTable = await read("source/shared/rpc/main.ts");
  assert.match(methodTable, /getAgentCustomization: \{ args: "none" \}/);
  assert.match(methodTable, /setAgentCustomization: \{ args: "object" \}/);
  const mainEdge = await read("source/electron-main/main-edge.ts");
  assert.match(mainEdge, /getAgentCustomization: \(\) => invoke\(deps\.settingsStore, "getAgentCustomization"\)/);
  assert.match(mainEdge, /setAgentCustomization: \(raw\) => \{ const value = normalizeSandAgentCustomization\(req\(raw\)\.customization\); invoke\(deps\.settingsStore, "setAgentCustomization", value\)/);
  const preload = await read("source/electron-preload/preload.ts");
  assert.match(preload, /getAgentCustomization: \(\) => edge\("getAgentCustomization"\)/);
  assert.match(preload, /setAgentCustomization: \(customization: unknown\) => edge\("setAgentCustomization", \{ customization \}\)/);
});

test("routed turns apply the saved customization across every provider branch", async () => {
  const read = async relative => await readFile(path.join(repoRoot, relative), "utf8");
  const session = await read("source/host/extensions/inference/provider-session.ts");
  assert.match(session, /export function routedSystemPrompt\(customization\?: SandAgentCustomization \| null\): string/);
  assert.match(session, /const systemPrompt = routedSystemPrompt\(options\?\.agentCustomization\)/);
  assert.match(session, /codexExecutor\(messages, invocationId, options\?\.tools, options\?\.executeTool, onUsage, systemPrompt\)/);
  assert.match(session, /claudeExecutor\(messages, invocationId, onUsage, options\?\.mcpServerUrl, systemPrompt\)/);
  assert.match(session, /openRouterExecutor\(messages, invocationId, options\?\.tools, options\?\.executeTool, onUsage, systemPrompt\)/);
  const router = await read("source/node-agent-coordinator/inference-router.ts");
  assert.match(router, /const agentCustomization = settings\.getAgentCustomization\(\);/);
  assert.match(router, /\.\.\.\(agentCustomization === undefined \? \{\} : \{ agentCustomization \}\)/);
});

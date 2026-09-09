import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = path.join(repoRoot, "plugins");

const EXPECTED = [
  "cheshire-agent-identity-registry", "cheshire-agent-registries", "cheshire-agent-reputation-registry",
  "cheshire-agent-validation-registry", "cheshire-api", "cheshire-noxa", "cheshire-omni-mint",
  "cheshire-terminal", "cheshire-zk-omni", "clawd-agent-launchpad", "clawd-code-skill",
  "clawd-skills-installer", "clawd-token-ops", "clawd-trading-terminal", "clawdex", "clawdhub",
  "dex-screener-scanner", "dflow-docs", "dflow-kalshi-market-data", "dflow-kalshi-market-scanner",
  "dflow-kalshi-portfolio", "dflow-kalshi-trading", "dflow-phantom-connect", "dflow-platform-fees",
  "dflow-proof-kyc", "dflow-spot-trading", "helius", "helius-dflow", "helius-jupiter", "helius-okx",
  "helius-phantom", "imperial", "imperial-margin-operations", "imperial-portfolio-intel",
  "imperial-position-management", "imperial-skills-index", "imperial-tpsl-management",
  "pump-admin-ops", "pump-ai-agents", "pump-bonding-curve", "pump-build-release", "pump-fee-sharing",
  "pump-fee-system", "pump-mcp-server", "pump-rust-vanity", "pump-shell-scripts",
  "pump-solana-architecture", "pump-solana-wallet", "pump-testing", "pump-token-incentives",
  "pump-token-lifecycle", "pump-ts-vanity", "pumpfun", "pumpfun-analytics", "pumpfun-fees",
  "pumpfun-launcher", "pumpfun-trading",
];

async function loadSkills() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "bundled-skills-"));
  const output = path.join(temporary, "bundled-trading-skills.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/shared/bundled-trading-skills.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("bundled trading plugin keeps each requested skill and its support files once", async () => {
  const loaded = await loadSkills();
  try {
    const listed = loaded.module.listBundledPluginSkills(pluginsRoot);
    const ids = listed.map(skill => skill.id);
    for (const id of EXPECTED) assert.ok(ids.includes(id), `missing skill ${id}`);
    assert.equal(ids.filter(id => id === "swarm-orchestrator").length, 0);
    assert.equal(ids.filter(id => id === "cheshire-api").length, 1);
    const cheshire = listed.find(skill => skill.id === "cheshire-api");
    assert.ok(cheshire.supportFiles.includes("references/endpoints.md"));
    assert.ok(cheshire.supportFiles.includes("scripts/smoke-discovery.sh"));
    const helius = listed.find(skill => skill.id === "helius");
    assert.ok(helius.supportFiles.some(file => file.startsWith("references/")));
    const code = listed.find(skill => skill.id === "clawd-code-skill");
    assert.ok(code.supportFiles.includes("src/index.ts"));
    assert.ok(listed.some(skill => skill.id.startsWith("paybox-")));
  } finally { await loaded.dispose(); }
});

test("bundled_skill_list and bundled_skill_read serve the shipped plugin files", async () => {
  const loaded = await loadSkills();
  try {
    const listed = loaded.module.executeBundledSkillTool("bundled_skill_list", {}, pluginsRoot);
    assert.equal(listed.ok, true);
    assert.ok(listed.count >= EXPECTED.length);
    assert.ok(listed.skills.some(skill => skill.id === "pumpfun"));
    const skill = loaded.module.executeBundledSkillTool("bundled_skill_read", { name: "cheshire-api" }, pluginsRoot);
    assert.match(skill.content, /Cheshire API/);
    assert.equal(skill.path, "SKILL.md");
    const support = loaded.module.executeBundledSkillTool("bundled_skill_read", { name: "cheshire-api", path: "references/endpoints.md" }, pluginsRoot);
    assert.match(support.content, /cheshireterminal/i);
    assert.throws(() => loaded.module.executeBundledSkillTool("bundled_skill_read", { name: "cheshire-api", path: "../paybox/README.md" }, pluginsRoot), /inside the skill folder/);
    assert.throws(() => loaded.module.executeBundledSkillTool("bundled_skill_read", { name: "not-a-skill" }, pluginsRoot), /Unknown bundled skill/);
    assert.equal(loaded.module.isBundledSkillTool("bundled_skill_list"), true);
    assert.equal(loaded.module.isBundledSkillTool("pump_recent_launches"), false);
  } finally { await loaded.dispose(); }
});

test("imported coordinator and provider surface the bundled skill tools", async () => {
  const router = await (await import("node:fs/promises")).readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  const provider = await (await import("node:fs/promises")).readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  assert.match(router, /isBundledSkillTool/);
  assert.match(router, /BUNDLED_SKILL_ROUTED_TOOLS/);
  assert.match(provider, /renderBundledSkillsCatalog/);
});

test("installing bundled plugins writes a plugin-skills catalog the host can list", async () => {
  const loaded = await loadSkills();
  const installDir = await mkdtemp(path.join(os.tmpdir(), "bundled-install-"));
  const installOut = path.join(installDir, "install.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/plugins/bundled-plugin-install.ts")],
    outfile: installOut,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  try {
    const installer = await import(`${pathToFileURL(installOut).href}?${Date.now()}`);
    const sandRoot = path.join(installDir, "sand");
    const result = installer.installBundledPluginSkills(sandRoot, pluginsRoot);
    assert.ok(result.installed >= EXPECTED.length);
    assert.ok(result.skills.some(skill => skill.id === "pumpfun"));
    const cache = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(sandRoot, "plugin-skills", "cache.json"), "utf8"));
    assert.ok(cache.skills.some(skill => skill.id === "cheshire-api" && skill.filePath.endsWith("SKILL.md")));
  } finally {
    await loaded.dispose();
    await rm(installDir, { recursive: true, force: true });
  }
});

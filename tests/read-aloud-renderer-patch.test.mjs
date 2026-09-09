import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as acorn from "acorn";

import { applyOriginalRendererReadAloudPatch } from "../scripts/lib/read-aloud-renderer-patch.mjs";
import { applyOriginalRendererSolanaModePatch } from "../scripts/lib/solana-mode-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENTRY_SOURCE = [
  "var rpc = { async upsertSecrets(entries) { return entries; } };",
  'var heading = {title:"Meet Clawd Bot"};',
  "export default rpc;",
].join("\n");

async function makeStage() {
  const stageRoot = await mkdtemp(path.join(os.tmpdir(), "renderer-patch-stage-"));
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  await mkdir(assetsRoot, { recursive: true });
  await writeFile(path.join(assetsRoot, "entry-ABC123.js"), ENTRY_SOURCE);
  await writeFile(path.join(stageRoot, "dist", "renderer", "index.html"), "<title>Grok Bot</title>");
  return { stageRoot, entryName: "entry-ABC123.js", dispose: () => rm(stageRoot, { recursive: true, force: true }) };
}

function parseModule(source, label) {
  try {
    acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch (error) {
    throw new Error(`${label} produced invalid JavaScript: ${error.message}`);
  }
}

test("solana mode patch injects a runtime with no unresolved style id and valid syntax", async () => {
  const stage = await makeStage();
  try {
    const record = await applyOriginalRendererSolanaModePatch({ stageRoot: stage.stageRoot });
    assert.equal(record.chunks.length, 1);
    const patched = await readFile(path.join(stage.stageRoot, "dist", "renderer", "assets", stage.entryName), "utf8");
    assert.match(patched, /__sandSolanaModeInstalled/);
    assert.doesNotMatch(patched, /=\s*STYLE_ID\b/, "STYLE_ID must never appear; it throws ReferenceError in the shipped renderer");
    assert.match(patched, /style\.id = "sand-solana-mode"/);
    parseModule(patched, "solana-mode patch");
  } finally { await stage.dispose(); }
});

test("read-aloud patch injects the free-voice runtime into the entry chunk with valid syntax", async () => {
  const stage = await makeStage();
  try {
    const record = await applyOriginalRendererReadAloudPatch({ stageRoot: stage.stageRoot });
    assert.equal(record.mode, "original-renderer-read-aloud");
    assert.deepEqual(record.features, ["read-aloud-toolbar", "free-openrouter-tts-playback"]);
    const patched = await readFile(path.join(stage.stageRoot, "dist", "renderer", "assets", stage.entryName), "utf8");
    assert.match(patched, /__sandReadAloudInstalled/);
    assert.match(patched, /window\.desktop\.speech\.synthesize/);
    assert.match(patched, /sand-message-hover-actions/);
    assert.match(patched, /data-role.*assistant/);
    parseModule(patched, "read-aloud patch");
    const provenance = JSON.parse(await readFile(record.provenancePath, "utf8"));
    assert.equal(provenance.schemaVersion, 1);
  } finally { await stage.dispose(); }
});

test("the fidelity package pipeline applies both renderer extensions", async () => {
  const cleanBuild = await readFile(path.join(repoRoot, "scripts", "clean-build.mjs"), "utf8");
  assert.match(cleanBuild, /applyOriginalRendererRouterPatch\(\{ stageRoot \}\)/);
  assert.match(cleanBuild, /applyOriginalRendererSolanaModePatch\(\{ stageRoot \}\)/);
  assert.match(cleanBuild, /applyOriginalRendererReadAloudPatch\(\{ stageRoot \}\)/);
  const order = [
    cleanBuild.indexOf("applyOriginalRendererRouterPatch({ stageRoot })"),
    cleanBuild.indexOf("applyOriginalRendererSolanaModePatch({ stageRoot })"),
    cleanBuild.indexOf("applyOriginalRendererReadAloudPatch({ stageRoot })"),
  ];
  assert.deepEqual([...order].sort((a, b) => a - b), order, "renderer patches must apply in the documented order");
});

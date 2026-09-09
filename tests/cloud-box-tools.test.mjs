import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test('hop installer transfers actual files within command limits and verifies their bytes', async () => {
  const loaded = await loadModule('source/node-agent-coordinator/cloud-hop-installer.ts');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hop-transfer-'));
  const artifacts = await Promise.all(['openai-hop-session.cjs','provider-maps.cjs'].map(async name => ({name,bytes:await readFile(path.join(repoRoot,name.startsWith('openai')?'box':'tools',name))})));
  const run = promisify(execFile);
  try {
    const result = await loaded.module.installCloudHop(artifacts, async (name,args) => {
      if (name === 'e2b_computer_status') return {};
      assert.ok(args.command.length <= 16384);
      const command = args.command.replaceAll('/home/user/sand-data',temporary);
      const { stdout } = await run('/bin/sh',['-c',command],{env:{...process.env,PATH:`${path.dirname(process.execPath)}:${process.env.PATH}`}});
      return { exitCode:0,stdout:stdout.replaceAll(temporary,'/home/user/sand-data') };
    });
    assert.equal(result.ok,true);
    assert.equal(result.consumerInstalled,false);
    for (const artifact of artifacts) assert.deepEqual(await readFile(path.join(temporary,artifact.name)),artifact.bytes);
    let calls = 0;
    await assert.rejects(loaded.module.installCloudHop(artifacts,async name=>{
      calls++; return name==='e2b_computer_status'?{}:{exitCode:1,stdout:'failed'};
    }),/not verified/);
    assert.equal(calls,2);
  } finally { await loaded.dispose(); await rm(temporary,{recursive:true,force:true}); }
});

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-cloud-box-"));
  const output = path.join(temporary, `${path.basename(entry, ".ts")}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("cloud_box_doctor reports E2B as the box, Browser Use as computers, and OpenGrok hop files", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/cloud-box-tools.ts");
  try {
    const names = loaded.module.cloudBoxRoutedTools().map(tool => tool.name);
    assert.deepEqual(names, ["cloud_box_doctor", "cloud_box_install_hop"]);
    const previousE2b = process.env.E2B_API_KEY;
    const previousBrowser = process.env.BROWSER_USE_API_KEY;
    delete process.env.E2B_API_KEY;
    delete process.env.BROWSER_USE_API_KEY;
    delete process.env.BROWSERUSE_API_KEY;
    const report = await loaded.module.executeCloudBoxRoutedTool("cloud_box_doctor", {});
    assert.equal(report.box.provider, "e2b");
    assert.equal(report.box.env, "E2B_API_KEY");
    assert.equal(report.computers.provider, "browser-use");
    assert.ok(report.computers.env.includes("BROWSERUSE_API_KEY"));
    assert.equal(report.opengrokFiles.some(file => file.relative === "box/openai-hop-session.cjs" && file.present), true);
    assert.equal(report.opengrokFiles.some(file => file.relative === "tools/provider-maps.cjs" && file.present), true);
    assert.equal(report.opengrokFiles.some(file => file.relative === "tools/file-relay.py" && file.present), true);
    if (previousE2b != null) process.env.E2B_API_KEY = previousE2b;
    if (previousBrowser != null) process.env.BROWSER_USE_API_KEY = previousBrowser;
  } finally { await loaded.dispose(); }
});

test("OpenGrok hop artifacts and docs exist in the shipped tree", async () => {
  for (const relative of [
    "box/openai-hop-session.cjs",
    "tools/provider-maps.cjs",
    "tools/file-relay.py",
    "docs/opengrok/BOX-INTEGRATION.md",
    "docs/opengrok/CLOUD-HOST.md",
    "docs/opengrok/README.md",
  ]) {
    await access(path.join(repoRoot, relative));
  }
  const hop = await readFile(path.join(repoRoot, "box/openai-hop-session.cjs"), "utf8");
  assert.match(hop, /createOpenAiHopSession|openai-hop-session|hop/i);
  const doctor = await readFile(path.join(repoRoot, "source/node-agent-coordinator/cloud-box-tools.ts"), "utf8");
  assert.match(doctor, /E2B_API_KEY/);
  assert.match(doctor, /BROWSERUSE_API_KEY/);
  const router = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(router, /isCloudBoxRoutedTool\(name\)\) return executeCloudBoxRoutedTool/);
  assert.match(router, /\.\.\.e2bRoutedTools\(\), \.\.\.browserUseRoutedTools\(\)/);
});

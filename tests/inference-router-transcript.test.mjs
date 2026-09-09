import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-inference-router-transcript-"));
  const output = path.join(temporary, "inference-router.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("routed transcript preserves structured MCP mention rich text across reload", async () => {
  const loaded = await loadModule();
  try {
    const richText = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "mention", attrs: { id: "mcp:3213107", label: "Gmail" } },
        { type: "text", text: " what's new?" },
      ] }],
    });
    const store = loaded.module.parseInferenceRouterTranscriptStore({
      schemaVersion: 2,
      agents: {
        agent: [{
          provider: "codex",
          role: "user",
          content: "@Gmail what's new?",
          richText,
          id: "t1u",
          clientNonce: "nonce-1",
          timestampMs: 123,
        }],
      },
    });
    const projected = loaded.module.projectInferenceRouterTranscriptEntry(store.agents.agent[0]);
    assert.equal(projected.richText, richText);
    assert.deepEqual(JSON.parse(projected.richText).content[0].content[0], {
      type: "mention",
      attrs: { id: "mcp:3213107", label: "Gmail" },
    });
  } finally {
    await loaded.dispose();
  }
});

test("routed transcript rejects malformed rich text carriers", async () => {
  const loaded = await loadModule();
  try {
    const store = loaded.module.parseInferenceRouterTranscriptStore({
      schemaVersion: 2,
      agents: {
        agent: [{ provider: "codex", role: "user", content: "@Gmail", richText: {}, id: "t1u", timestampMs: 123 }],
      },
    });
    assert.deepEqual(store.agents.agent, []);
  } finally {
    await loaded.dispose();
  }
});

test("hosted conversations use the durable host engine and preserve local history without ID collisions", async () => {
  const loaded=await loadModule();
  const dir=await mkdtemp(path.join(os.tmpdir(),'hosted-router-'));
  try {
    await writeFile(path.join(dir,'settings.json'),JSON.stringify({version:1,inferenceProvider:'openrouter',inferenceRouterModel:'openrouter/free'}));
    const calls=[];
    const router=loaded.module.createCoordinatorInferenceRouter({dataDir:dir,useHostedRuntime:()=>true,postEvent:()=>{},dispatchRemote:async(method,args)=>{
      calls.push({method,args});
      if(method==='setHostSettings')return {};
      return {entries:[{id:'t0u',kind:'message',role:'user',content:'cloud message',timestampMs:20}]};
    }});
    assert.deepEqual(await router.dispatch('sendPrompt',{agentId:'agent',prompt:'hello'}),{handled:false});
    assert.deepEqual(calls,[{method:'setHostSettings',args:{inferenceProvider:'openrouter',inferenceRouterModel:'openrouter/free'}}]);
    await assert.rejects(access(path.join(dir,'inference-router-transcript.json')));
    await writeFile(path.join(dir,'inference-router-transcript.json'),JSON.stringify({schemaVersion:2,agents:{agent:[{provider:'openrouter',role:'user',content:'older local message',id:'t0u',timestampMs:10}]}}));
    const result=await router.dispatch('getAgentTranscriptTail',{id:'agent'});
    assert.deepEqual(result.value.entries.map(entry=>entry.id),['legacy:t0u','t0u']);
    assert.deepEqual(await router.dispatch('reactToMessage',{agentId:'agent',entryId:'t0u',emoji:'👍'}),{handled:false});
    const failed=loaded.module.createCoordinatorInferenceRouter({dataDir:dir,useHostedRuntime:()=>true,postEvent:()=>{},dispatchRemote:async()=>{throw new Error('host unavailable');}});
    await assert.rejects(failed.dispatch('sendPrompt',{agentId:'agent',prompt:'hello'}),/host unavailable/);
  } finally { await loaded.dispose(); await rm(dir,{recursive:true,force:true}); }
});

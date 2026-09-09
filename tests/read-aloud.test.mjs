import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadReadAloud() {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "read-aloud-"));
  const outfile = path.join(scratch, "read-aloud.mjs");
  try {
    await build({
      absWorkingDir: repoRoot,
      entryPoints: [path.join(repoRoot, "frontend/src/recovered/features/conversation/cards/transcript-card/read-aloud.ts")],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      outfile,
      logLevel: "silent",
    });
    return await import(`file://${outfile}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

class FakeAudio {
  static instances = [];
  constructor(src) {
    this.src = src;
    this.paused = true;
    this.failPlay = false;
    FakeAudio.instances.push(this);
  }
  async play() {
    if (this.failPlay) throw new Error("playback blocked");
    this.paused = false;
  }
  pause() { this.paused = true; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
}

function speechResult(audioBase64 = "QUJD", format = "mp3") {
  return { ok: true, model: "deepgram/flux-tts:free", format, audioBase64, bytes: 3, generationId: "gen-1" };
}

test("read aloud synthesizes through the free OpenRouter model and plays the returned audio", async () => {
  const { createReadAloudController } = await loadReadAloud();
  FakeAudio.instances = [];
  const requests = [];
  const controller = createReadAloudController({
    synthesize: async request => {
      requests.push(request);
      return speechResult();
    },
    audioConstructor: FakeAudio,
  });
  const states = [];
  controller.subscribe(state => states.push(state));
  await controller.toggle("a1", "Hello there");
  assert.deepEqual(requests, [{ text: "Hello there" }]);
  const played = FakeAudio.instances.at(-1);
  assert.match(played.src, /^data:audio\/mp3;base64,QUJD$/);
  assert.equal(played.paused, false);
  assert.deepEqual(controller.getState(), { entryId: "a1", status: "playing" });
  assert.equal(states.at(-1).status, "playing");

  controller.stop();
  assert.deepEqual(controller.getState(), { entryId: null, status: null });
  assert.equal(played.paused, true);
});

test("toggling the same entry stops playback and a second entry switches sources", async () => {
  const { createReadAloudController } = await loadReadAloud();
  FakeAudio.instances = [];
  const requests = [];
  const controller = createReadAloudController({
    synthesize: async request => {
      requests.push(request);
      return speechResult();
    },
    audioConstructor: FakeAudio,
  });
  await controller.toggle("a1", "one");
  const first = FakeAudio.instances[0];
  await controller.toggle("a1", "one");
  assert.equal(first.paused, true);
  assert.deepEqual(controller.getState(), { entryId: null, status: null });

  await controller.toggle("a2", "two");
  assert.equal(FakeAudio.instances.length, 2);
  assert.deepEqual(controller.getState(), { entryId: "a2", status: "playing" });
  assert.deepEqual(requests.map(request => request.text), ["one", "two"]);
});

test("stale synthesis results are ignored and failures fall back to idle without throwing", async () => {
  const { createReadAloudController } = await loadReadAloud();
  FakeAudio.instances = [];
  let releaseSynthesis;
  const controller = createReadAloudController({
    synthesize: () => new Promise(resolve => { releaseSynthesis = resolve; }),
    audioConstructor: FakeAudio,
  });
  const pending = controller.toggle("a1", "slow voice");
  controller.stop();
  releaseSynthesis(speechResult());
  await pending;
  assert.deepEqual(controller.getState(), { entryId: null, status: null });
  assert.equal(FakeAudio.instances.length, 0);

  const failing = createReadAloudController({
    synthesize: async () => { throw new Error("Set OPENROUTER_API_KEY to use free speech (Settings → Router)."); },
    audioConstructor: FakeAudio,
  });
  await failing.toggle("b1", "no key");
  assert.deepEqual(failing.getState(), { entryId: null, status: null });
});

test("the whole free-voice surface is wired across rpc table, main edge, preload, contracts, and message actions", async () => {
  const read = relative => readFile(path.join(repoRoot, relative), "utf8");
  const rpcTable = await read("source/shared/rpc/main.ts");
  assert.match(rpcTable, /speechSynthesize: \{ args: "object" \}/);
  const rendererRpc = await read("frontend/src/recovered/contracts/main-rpc.ts");
  assert.match(rendererRpc, /speechSynthesize: "object"/);
  assert.match(rendererRpc, /speechSynthesize: \{ text: string; voice\?: string \}/);
  const mainEdge = await read("source/electron-main/main-edge.ts");
  assert.match(mainEdge, /from "\.\.\/node-agent-coordinator\/grok-media-tools\.js"/);
  assert.match(mainEdge, /speechSynthesize: async \(raw\) =>/);
  assert.match(mainEdge, /synthesizeGrokSpeech\(\{ text/);
  const preload = await read("source/electron-preload/preload.ts");
  assert.match(preload, /speech: \{/);
  assert.match(preload, /synthesize: \(request: \{ text: string; voice\?: string \}\) => edge\("speechSynthesize", request\)/);
  const bridge = await read("frontend/src/recovered/contracts/desktop-bridge.ts");
  assert.match(bridge, /interface SpeechDesktopBridge/);
  assert.match(bridge, /readonly speech: SpeechDesktopBridge;/);
  const mediaTools = await read("source/node-agent-coordinator/grok-media-tools.ts");
  assert.match(mediaTools, /export async function synthesizeGrokSpeech/);
  assert.match(mediaTools, /resolveOpenRouterTtsModel\(process\.env\)/);
  const actions = await read("frontend/src/recovered/features/conversation/cards/transcript-card/message-actions.tsx");
  assert.match(actions, /readAloudMenuItem/);
  assert.match(actions, /data-icon-name=\{readAloudActive \? "stop" : "speaker-waves"\}/);
  assert.match(actions, /"Loading voice…" : "Stop reading"\) : "Read aloud"\}/);
  const productionRenderer = await read("frontend/src/production/ProductionRenderer.tsx");
  assert.match(productionRenderer, /createReadAloudController\(\{/);
  assert.match(productionRenderer, /bridge\.speech\.synthesize\(request\)/);
});

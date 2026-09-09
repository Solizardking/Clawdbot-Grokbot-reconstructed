import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "source/node-agent-coordinator/grok-media-tools.ts");
test('hosted speech uses only the gateway token and fails closed after rejection',async()=>{
  const loaded=await loadGrokMediaTools();
  const beforeUrl=process.env.SAND_HOSTED_GATEWAY_URL,beforeToken=process.env.SAND_HOSTED_GATEWAY_TOKEN;
  process.env.SAND_HOSTED_GATEWAY_URL='https://gateway.test';
  process.env.SAND_HOSTED_GATEWAY_TOKEN='a'.repeat(43);
  let calls=0;
  try {
    loaded.module.configureGrokMediaBridgeForTests({apiKey:'local-key',fetchImpl:async(url,init)=>{
      calls++;
      assert.equal(url,'https://gateway.test/openrouter/v1/audio/speech');
      assert.equal(init.headers.authorization,'Bearer '+'a'.repeat(43));
      assert.equal(init.redirect,'error');
      assert.doesNotMatch(JSON.stringify(init),/local-key/);
      return errorResponse({error:'Not enabled'},403);
    }});
    await assert.rejects(loaded.module.synthesizeGrokSpeech({text:'hello'}),/HTTP 403/);
    assert.equal(calls,1);
  } finally {
    if(beforeUrl===undefined)delete process.env.SAND_HOSTED_GATEWAY_URL;else process.env.SAND_HOSTED_GATEWAY_URL=beforeUrl;
    if(beforeToken===undefined)delete process.env.SAND_HOSTED_GATEWAY_TOKEN;else process.env.SAND_HOSTED_GATEWAY_TOKEN=beforeToken;
    await loaded.dispose();
  }
});

async function loadGrokMediaTools() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-media-tools-"));
  const output = path.join(temporary, "grok-media-tools.mjs");
  await build({
    entryPoints: [sourcePath],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function binaryResponse(bytes, generationId = null) {
  const buffer = Uint8Array.from(bytes);
  return {
    ok: true,
    status: 200,
    headers: { get: name => name.toLowerCase() === "x-generation-id" ? generationId : null },
    json: async () => { throw new Error("binary response"); },
    text: async () => "",
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

function errorResponse(body, status) {
  return {
    ok: false,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init.body == null ? null : JSON.parse(init.body) });
    return handler(url, JSON.parse(init.body));
  };
  impl.calls = calls;
  return impl;
}

test("no OPENROUTER_API_KEY hides the tools and execution explains how to fix it", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  try {
    grok.configureGrokMediaBridgeForTests({ apiKey: undefined });
    assert.deepEqual(grok.grokMediaRoutedTools(), []);
    await assert.rejects(grok.executeGrokMediaRoutedTool("grok_imagine", { prompt: "x" }), /OPENROUTER_API_KEY/);
    assert.equal(grok.isGrokMediaRoutedTool("grok_imagine"), true);
    assert.equal(grok.isGrokMediaRoutedTool("pump_recent_launches"), false);
  } finally { await loaded.dispose(); }
});

test("tool catalog exposes imagine, speak, and transcribe with grok model defaults in descriptions", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  try {
    assert.deepEqual(grok.GROK_ROUTED_TOOLS.map(tool => tool.name), ["grok_imagine", "grok_speak", "grok_transcribe"]);
    for (const tool of grok.GROK_ROUTED_TOOLS) {
      assert.equal(tool.providerIdentifier, "grok-bot-openrouter-media");
      assert.equal(tool.toolName, tool.name);
      assert.match(tool.description, /OpenRouter/);
    }
    const speak = grok.GROK_ROUTED_TOOLS.find(tool => tool.name === "grok_speak");
    assert.match(speak.description, /deepgram\/flux-tts:free/);
  } finally { await loaded.dispose(); }
});

test("grok_imagine posts to /images with the default Imagine 2.0 model and saves a PNG file", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "grok-media-out-"));
  delete process.env.OPENROUTER_GROK_IMAGINE;
  try {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchImpl = fakeFetch((url, body) => {
      assert.equal(url, "https://openrouter.ai/api/v1/images");
      assert.equal(body.model, "x-ai/grok-imagine-image-2.0");
      assert.equal(body.prompt, "a red panda astronaut");
      assert.deepEqual(body, { model: "x-ai/grok-imagine-image-2.0", prompt: "a red panda astronaut" });
      return jsonResponse({ data: [{ b64_json: Buffer.from(pngBytes).toString("base64"), media_type: "image/png" }], usage: { cost: 0.04 } });
    });
    grok.configureGrokMediaBridgeForTests({ apiKey: "or_test", fetchImpl, outputDir });
    const result = await grok.executeGrokMediaRoutedTool("grok_imagine", { prompt: "a red panda astronaut" });
    assert.equal(result.ok, true);
    assert.equal(result.model, "x-ai/grok-imagine-image-2.0");
    assert.equal(result.count, 1);
    assert.equal(result.files[0].bytes, pngBytes.byteLength);
    const saved = await readFile(result.files[0].path);
    assert.deepEqual([...saved], [...pngBytes]);
    assert.equal(result.usage.cost, 0.04);
  } finally {
    await loaded.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("OPENROUTER_GROK_IMAGINE overrides the image model and options pass through", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "grok-media-out-"));
  process.env.OPENROUTER_GROK_IMAGINE = "x-ai/custom-imagine";
  try {
    const fetchImpl = fakeFetch((url, body) => {
      assert.equal(body.model, "x-ai/custom-imagine");
      assert.equal(body.aspect_ratio, "16:9");
      assert.equal(body.resolution, "2K");
      assert.equal(body.quality, "medium");
      return jsonResponse({ data: [{ b64_json: Buffer.from("jpeg").toString("base64"), media_type: "image/jpeg" }] });
    });
    grok.configureGrokMediaBridgeForTests({ apiKey: "or_test", fetchImpl, outputDir });
    const result = await grok.executeGrokMediaRoutedTool("grok_imagine", { prompt: "sunset", aspect_ratio: "16:9", resolution: "2K", quality: "medium" });
    assert.equal(result.files[0].path.endsWith(".jpg"), true);
  } finally {
    delete process.env.OPENROUTER_GROK_IMAGINE;
    await loaded.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("grok_speak consumes raw audio bytes and records X-Generation-Id", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "grok-media-out-"));
  delete process.env.OPENROUTER_VOICE;
  delete process.env.OPENROUTER_GROK_VOICE;
  try {
    const audio = [0xff, 0xf3, 0x40, 0xc4];
    const fetchImpl = fakeFetch((url, body) => {
      assert.equal(url, "https://openrouter.ai/api/v1/audio/speech");
      assert.equal(body.model, "deepgram/flux-tts:free");
      assert.equal(body.input, "Hello there");
      assert.equal(body.voice, "flux-alexis-en");
      assert.equal(body.response_format, "mp3");
      return binaryResponse(audio, "gen-123");
    });
    grok.configureGrokMediaBridgeForTests({ apiKey: "or_test", fetchImpl, outputDir });
    const result = await grok.executeGrokMediaRoutedTool("grok_speak", { text: "Hello there", voice: "flux-alexis-en" });
    assert.equal(result.ok, true);
    assert.equal(result.model, "deepgram/flux-tts:free");
    assert.equal(result.generationId, "gen-123");
    assert.equal(result.file.bytes, audio.length);
    const saved = await readFile(result.file.path);
    assert.equal(saved.byteLength, audio.length);
  } finally {
    await loaded.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("OPENROUTER_VOICE overrides the TTS model ahead of OPENROUTER_GROK_VOICE", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "grok-media-out-"));
  process.env.OPENROUTER_VOICE = "deepgram/flux-tts:free";
  process.env.OPENROUTER_GROK_VOICE = "x-ai/custom-voice";
  try {
    const fetchImpl = fakeFetch((url, body) => {
      assert.equal(body.model, "deepgram/flux-tts:free");
      assert.equal(body.voice, "flux-alexis-en");
      return binaryResponse([9, 9, 9]);
    });
    grok.configureGrokMediaBridgeForTests({ apiKey: "or_test", fetchImpl, outputDir });
    const result = await grok.executeGrokMediaRoutedTool("grok_speak", { text: "hi", voice: "flux-alexis-en" });
    assert.equal(result.model, "deepgram/flux-tts:free");
  } finally {
    delete process.env.OPENROUTER_VOICE;
    delete process.env.OPENROUTER_GROK_VOICE;
    await loaded.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("OPENROUTER_GROK_VOICE overrides the TTS model and wav format changes the extension", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "grok-media-out-"));
  delete process.env.OPENROUTER_VOICE;
  process.env.OPENROUTER_GROK_VOICE = "x-ai/custom-voice";
  try {
    const fetchImpl = fakeFetch((url, body) => {
      assert.equal(body.model, "x-ai/custom-voice");
      assert.equal(body.response_format, "wav");
      return binaryResponse([1, 2, 3, 4]);
    });
    grok.configureGrokMediaBridgeForTests({ apiKey: "or_test", fetchImpl, outputDir });
    const result = await grok.executeGrokMediaRoutedTool("grok_speak", { text: "hi", format: "wav" });
    assert.equal(result.format, "wav");
    assert.equal(result.file.path.endsWith(".wav"), true);
  } finally {
    delete process.env.OPENROUTER_GROK_VOICE;
    await loaded.dispose();
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("synthesizeGrokSpeech returns base64 audio for renderer playback without writing files", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  delete process.env.OPENROUTER_VOICE;
  delete process.env.OPENROUTER_GROK_VOICE;
  try {
    const audio = [1, 2, 3, 4, 5];
    const fetchImpl = fakeFetch((url, body) => {
      assert.equal(url, "https://openrouter.ai/api/v1/audio/speech");
      assert.equal(body.model, "deepgram/flux-tts:free");
      assert.equal(body.input, "read me aloud");
      assert.deepEqual(body, { model: "deepgram/flux-tts:free", input: "read me aloud", voice: "flux-alexis-en", response_format: "mp3" });
      return binaryResponse(audio, "gen-render-1");
    });
    grok.configureGrokMediaBridgeForTests({ apiKey: "or_test", fetchImpl });
    const result = await grok.synthesizeGrokSpeech({ text: "read me aloud" });
    assert.deepEqual(result, { ok: true, model: "deepgram/flux-tts:free", format: "mp3", audioBase64: Buffer.from(audio).toString("base64"), bytes: audio.length, generationId: "gen-render-1" });
    await assert.rejects(grok.synthesizeGrokSpeech({ text: "   " }), /non-empty text/);
  } finally { await loaded.dispose(); }
});

test("grok_transcribe base64-encodes the local file into input_audio and returns the text", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  const scratch = await mkdtemp(path.join(os.tmpdir(), "grok-media-in-"));
  const audioPath = path.join(scratch, "clip.wav");
  const audioBytes = Buffer.from("RIFF....WAVEfmt ");
  await writeFile(audioPath, audioBytes);
  delete process.env.OPENROUTER_GROK_STT;
  try {
    const fetchImpl = fakeFetch((url, body) => {
      assert.equal(url, "https://openrouter.ai/api/v1/audio/transcriptions");
      assert.equal(body.model, "x-ai/grok-stt-1.0");
      assert.equal(body.input_audio.format, "wav");
      assert.equal(Buffer.from(body.input_audio.data, "base64").toString(), audioBytes.toString());
      return jsonResponse({ text: "hello from the tape", usage: { seconds: 1.5 } });
    });
    grok.configureGrokMediaBridgeForTests({ apiKey: "or_test", fetchImpl });
    const result = await grok.executeGrokMediaRoutedTool("grok_transcribe", { path: audioPath });
    assert.deepEqual({ ok: result.ok, text: result.text, format: result.format }, { ok: true, text: "hello from the tape", format: "wav" });
  } finally {
    await loaded.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("provider errors surface their message and unknown tools are rejected", async () => {
  const loaded = await loadGrokMediaTools();
  const grok = loaded.module;
  try {
    const fetchImpl = fakeFetch(() => errorResponse({ error: { message: "Insufficient credits" } }, 402));
    grok.configureGrokMediaBridgeForTests({ apiKey: "or_test", fetchImpl });
    await assert.rejects(grok.executeGrokMediaRoutedTool("grok_imagine", { prompt: "x" }), /Insufficient credits/);
    await assert.rejects(grok.executeGrokMediaRoutedTool("grok_nope", {}), /Unknown Grok media tool/);
  } finally { await loaded.dispose(); }
});

test("coordinator and telegram bridge both route grok_ tools through the local gate", async () => {
  const routerSource = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(routerSource, /from "\.\/grok-media-tools\.js"/);
  assert.match(routerSource, /isGrokMediaRoutedTool\(name\)\) return executeGrokMediaRoutedTool/);
  const servicesSource = await readFile(path.join(repoRoot, "source/electron-main/main-production-services.ts"), "utf8");
  assert.match(servicesSource, /from "\.\.\/node-agent-coordinator\/grok-media-tools\.js"/);
  assert.match(servicesSource, /\.\.\.grokMediaRoutedTools\(\)/);
});

test("shared contract pins the documented Grok model ids", async () => {
  const contractSource = await readFile(path.join(repoRoot, "source/shared/inference-router.ts"), "utf8");
  assert.match(contractSource, /SAND_DEFAULT_OPENROUTER_GROK_IMAGINE_MODEL = "x-ai\/grok-imagine-image-2\.0"/);
  assert.match(contractSource, /SAND_DEFAULT_OPENROUTER_GROK_VOICE_MODEL = "x-ai\/grok-voice-tts-1\.0"/);
  assert.match(contractSource, /SAND_DEFAULT_OPENROUTER_GROK_STT_MODEL = "x-ai\/grok-stt-1\.0"/);
});

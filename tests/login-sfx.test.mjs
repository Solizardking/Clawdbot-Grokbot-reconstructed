import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-sfx-"));
  const output = path.join(temporary, `${path.basename(entry, ".ts")}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    banner: { js: `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);` },
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function fakeSpawn(calls, payloads = []) {
  const impl = (command, args) => {
    calls.push([command, ...args]);
    try { payloads.push(readFileSync(args[0])); } catch { payloads.push(null); }
    const listeners = {};
    const child = {
      on(event, listener) { (listeners[event] ??= []).push(listener); return child; },
      emit(event) { for (const listener of listeners[event] ?? []) listener(); },
    };
    queueMicrotask(() => child.emit("exit"));
    return child;
  };
  return impl;
}

async function waitForCalls(calls, expected) {
  const deadline = Date.now() + 3000;
  while (calls.length < expected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(calls.length, expected, "playback did not complete within the deadline");
}

test("only a real interactive sign-in earns the fanfare", async () => {
  const loaded = await loadModule("source/electron-main/sfx/login-sfx.ts");
  try {
    const { shouldPlayLoginFanfare } = loaded.module;
    assert.equal(shouldPlayLoginFanfare({ hasSeenStatus: false, wasSignedIn: false, nextSignedIn: true, authId: "real" }), false, "session restore at launch is silent");
    assert.equal(shouldPlayLoginFanfare({ hasSeenStatus: true, wasSignedIn: false, nextSignedIn: true, authId: "real" }), true, "real sign-in plays");
    assert.equal(shouldPlayLoginFanfare({ hasSeenStatus: true, wasSignedIn: false, nextSignedIn: true, authId: "local-openrouter" }), false, "local account never plays");
    assert.equal(shouldPlayLoginFanfare({ hasSeenStatus: true, wasSignedIn: true, nextSignedIn: true, authId: "real" }), false, "staying signed in never plays");
    assert.equal(shouldPlayLoginFanfare({ hasSeenStatus: true, wasSignedIn: true, nextSignedIn: false, authId: undefined }), false, "logout never plays");
  } finally { await loaded.dispose(); }
});

test("play writes both embedded sounds and runs them in order via afplay", async () => {
  const loaded = await loadModule("source/electron-main/sfx/login-sfx.ts");
  try {
    const calls = [];
    const payloads = [];
    const player = loaded.module.createLoginFanfarePlayer({ spawnImpl: fakeSpawn(calls, payloads), platform: "darwin" });
    player.play();
    await waitForCalls(calls, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], "afplay");
    assert.equal(calls[1][0], "afplay");
    const first = payloads[0];
    const second = payloads[1];
    assert.ok(first.equals(Buffer.from(loaded.module.KACHING_SFX_BASE64, "base64")), "kaching payload round-trips");
    assert.ok(second.equals(Buffer.from(loaded.module.BANDOS_SFX_BASE64, "base64")), "bandos payload round-trips");
    assert.ok(first.length > 50_000, "kaching payload is embedded");
    assert.ok(second.length > 10_000, "bandos payload is embedded");
    assert.ok(calls[0][1].includes("sand-sfx-"));
  } finally { await loaded.dispose(); }
});

test("play debounces rapid re-triggers and ignores non-macOS platforms", async () => {
  const loaded = await loadModule("source/electron-main/sfx/login-sfx.ts");
  try {
    const calls = [];
    let clock = 100_000;
    const player = loaded.module.createLoginFanfarePlayer({ spawnImpl: fakeSpawn(calls), platform: "darwin", now: () => clock });
    player.play();
    clock += 100;
    player.play();
    clock += 5_000;
    player.play();
    await waitForCalls(calls, 4);
    assert.equal(calls.length, 4, "third play runs a fresh two-sound sequence after the debounce window");
    const linuxPlayer = loaded.module.createLoginFanfarePlayer({ spawnImpl: fakeSpawn(calls), platform: "linux" });
    linuxPlayer.play();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls.length, 4, "non-darwin platforms stay silent");
  } finally { await loaded.dispose(); }
});

test("play survives a missing afplay binary", async () => {
  const loaded = await loadModule("source/electron-main/sfx/login-sfx.ts");
  try {
    const spawnImpl = () => {
      const child = { on(event, listener) { if (event === "error") queueMicrotask(listener); return child; } };
      return child;
    };
    const player = loaded.module.createLoginFanfarePlayer({ spawnImpl, platform: "darwin" });
    player.play();
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally { await loaded.dispose(); }
});

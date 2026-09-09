import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-local-account-"));
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

function fakeService(overrides = {}) {
  const listeners = new Set();
  const service = {
    emit(status) { for (const listener of [...listeners]) listener(status); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getStatus: async () => ({ kind: "logged-out" }),
    getValidAccessToken: async () => { throw new Error("Sign in to Cursor to run Clawd Bot."); },
    revokeForAccountRefusal: async () => ({ kind: "completed", status: { kind: "logged-out" } }),
    login: async () => ({ kind: "logging-in" }),
    cancelLogin: async () => ({ kind: "logged-out" }),
    logout: async () => ({ kind: "logged-out" }),
    updateDisplayName: async () => ({ kind: "logged-out" }),
    ...overrides,
  };
  return service;
}

const LOGGED_IN = { kind: "logged-in", authId: "real-account" };

test("local account fallback keeps logged-out status when disabled", async () => {
  const loaded = await loadModule("source/electron-main/account/local-account-fallback.ts");
  try {
    const inner = fakeService();
    const wrapped = loaded.module.wrapAuthServiceWithLocalAccountFallback(inner, { isEnabled: () => false });
    assert.deepEqual(await wrapped.getStatus(), { kind: "logged-out" });
  } finally { await loaded.dispose(); }
});

test("local account fallback reports the local identity when enabled and signed out", async () => {
  const loaded = await loadModule("source/electron-main/account/local-account-fallback.ts");
  try {
    const inner = fakeService();
    const wrapped = loaded.module.wrapAuthServiceWithLocalAccountFallback(inner, { isEnabled: () => true });
    const status = await wrapped.getStatus();
    assert.equal(status.kind, "logged-in");
    assert.equal(status.authId, loaded.module.LOCAL_ACCOUNT_AUTH_ID);
  } finally { await loaded.dispose(); }
});

test("a real Cursor session always wins over the local account", async () => {
  const loaded = await loadModule("source/electron-main/account/local-account-fallback.ts");
  try {
    const inner = fakeService({ getStatus: async () => LOGGED_IN });
    const wrapped = loaded.module.wrapAuthServiceWithLocalAccountFallback(inner, { isEnabled: () => true });
    assert.deepEqual(await wrapped.getStatus(), LOGGED_IN);
  } finally { await loaded.dispose(); }
});

test("status emissions are remapped for subscribers while enabled", async () => {
  const loaded = await loadModule("source/electron-main/account/local-account-fallback.ts");
  try {
    const seen = [];
    const inner = fakeService({ getStatus: async () => LOGGED_IN });
    const wrapped = loaded.module.wrapAuthServiceWithLocalAccountFallback(inner, { isEnabled: () => true });
    wrapped.subscribe((status) => seen.push(status));
    inner.emit({ kind: "logging-in" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    inner.emit(LOGGED_IN);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(seen.length, 2);
    assert.equal(seen[0].kind, "logged-in");
    assert.equal(seen[0].authId, loaded.module.LOCAL_ACCOUNT_AUTH_ID);
    assert.deepEqual(seen[1], LOGGED_IN);
  } finally { await loaded.dispose(); }
});

test("logout stays usable under the local account instead of reporting signed-out", async () => {
  const loaded = await loadModule("source/electron-main/account/local-account-fallback.ts");
  try {
    const inner = fakeService();
    const wrapped = loaded.module.wrapAuthServiceWithLocalAccountFallback(inner, { isEnabled: () => true });
    const status = await wrapped.logout();
    assert.equal(status.kind, "logged-in");
    assert.equal(status.authId, loaded.module.LOCAL_ACCOUNT_AUTH_ID);
  } finally { await loaded.dispose(); }
});

test("token operations stay honest and still require a real Cursor session", async () => {
  const loaded = await loadModule("source/electron-main/account/local-account-fallback.ts");
  try {
    const failure = new Error("Sign in to Cursor to run Clawd Bot.");
    const inner = fakeService({ getValidAccessToken: async () => { throw failure; } });
    const wrapped = loaded.module.wrapAuthServiceWithLocalAccountFallback(inner, { isEnabled: () => true });
    await assert.rejects(wrapped.getValidAccessToken(), (error) => error === failure);
  } finally { await loaded.dispose(); }
});

async function loadWiring() {
  return await loadModule("source/electron-main/account/cursor-auth-wiring.ts");
}

function wiringDeps(overrides = {}) {
  return {
    openExternal: async () => {},
    getAccountRuntime: () => null,
    emitAuthStatus: () => {},
    sentryEnabled: false,
    settingsStore: {
      getLocalToolPermission: () => "ask",
      setLocalToolPermissionCeiling: () => {},
    },
    syncHostSettingsToBox: async () => {},
    fetchLocalToolPermissionCeiling: async () => { throw new Error("ceiling-denied"); },
    ...overrides,
  };
}

test("wiring exposes the local account when the routed provider is not cursor", async () => {
  const loaded = await loadWiring();
  try {
    let provider = "openrouter";
    const wiring = loaded.module.createCursorAuthWiring(wiringDeps({
      createAuthService: () => fakeService(),
      localAccountEnabled: () => provider !== "cursor",
    }));
    const service = await wiring.ensureCursorAuthService();
    const status = await service.getStatus();
    assert.equal(status.kind, "logged-in");
    assert.equal(status.authId, loaded.module.LOCAL_ACCOUNT_AUTH_ID);

    provider = "cursor";
    assert.deepEqual(await service.getStatus(), { kind: "logged-out" });
  } finally { await loaded.dispose(); }
});

test("wiring status delivery survives token-backed ceiling failures under the local account", async () => {
  const loaded = await loadWiring();
  try {
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    const emitted = [];
    const wiring = loaded.module.createCursorAuthWiring(wiringDeps({
      createAuthService: () => fakeService(),
      localAccountEnabled: () => true,
      emitAuthStatus: (status) => emitted.push(status),
    }));
    const service = await wiring.ensureCursorAuthService();
    wiring.deliverCursorAuthStatus(service, await service.getStatus());
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off("unhandledRejection", onUnhandled);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].kind, "logged-in");
    assert.equal(emitted[0].authId, loaded.module.LOCAL_ACCOUNT_AUTH_ID);
    assert.deepEqual(unhandled.filter((error) => String(error).includes("ceiling-denied")), []);
  } finally { await loaded.dispose(); }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createConnection } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = await mkdtemp(path.join(os.tmpdir(), "grok-bridge-tests-"));
test.after(async () => { await rm(scratchRoot, { recursive: true, force: true }); });

async function loadModule(relativePath) {
  const outfile = path.join(scratchRoot, `${relativePath.replace(/[^A-Za-z0-9._-]+/g, "__")}.mjs`);
  await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile,
    logLevel: "silent",
  });
  return await import(`file://${outfile}`);
}

const VALID_TOKEN = "1234567890:AAFidmExampleTokenValue1234567890xyz";

test("headless config resolves secrets, gates, and ports from raw env", async () => {
  const server = await loadModule("source/telegram-bridge-server/main.ts");
  const config = server.resolveBridgeEnvConfig({
    TELEGRAM_BOT_TOKEN: ` ${VALID_TOKEN} `,
    DEEPGRAM_API_KEY: "d".repeat(30),
    HELIUS_API_KEY: "hel",
    OPENROUTER_API_KEY: "sk-or-v1-abc",
    SAND_VOICE_GATEWAY_URL: "https://gateway.example//",
    PORT: "9090",
  });
  assert.equal(config.token, VALID_TOKEN);
  assert.equal(config.deepgramConfigured, true);
  assert.equal(config.heliusConfigured, true);
  assert.equal(server.resolveBridgeEnvConfig({ HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=x" }).heliusConfigured, true);
  assert.equal(config.openRouterConfigured, true);
  assert.equal(config.voiceGatewayUrl, "https://gateway.example");
  assert.equal(config.autoStart, true);
  assert.equal(config.port, 9090);

  const minimal = server.resolveBridgeEnvConfig({});
  assert.equal(minimal.token, null);
  assert.equal(minimal.autoStart, true, "autostart defaults on");
  assert.equal(minimal.port, 8080);
  assert.equal(server.resolveBridgeEnvConfig({ SAND_TELEGRAM_AUTOSTART: "0" }).autoStart, false);
  assert.equal(server.resolveBridgeEnvConfig({ PORT: "junk" }).port, 8080);
  assert.equal(server.resolveBridgeEnvConfig({ PORT: "0" }).port, 0);
  for (const port of ["65536", "-1", "1.5", "", " "]) {
    assert.equal(server.resolveBridgeEnvConfig({ PORT: port }).port, 8080);
  }
});

function fakeFetch() {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url instanceof URL ? url : url?.url ?? url);
    calls.push(href.replace(/bot[^/]+\//, "bot…/"));
    const json = (payload) => new Response(JSON.stringify(payload), { status: 200 });
    if (href.includes("/getMe")) return json({ ok: true, result: { id: 1, username: "hosted_bot" } });
    if (href.includes("/getUpdates")) return json({ ok: true, result: [] });
    if (href.includes("/sendMessage") || href.includes("/sendVoice")) return json({ ok: true, result: {} });
    if (href.includes("mainnet.helius-rpc.com")) return json({ jsonrpc: "2.0", id: 1, result: { total: 0, items: [] } });
    if (href.includes("clawd-ws.fly.dev")) throw new Error("no ws in tests");
    throw new Error(`fakeFetch cannot handle ${href}`);
  };
  return { fetchImpl, calls };
}

async function withServer(envOverrides, run) {
  const server = await loadModule("source/telegram-bridge-server/main.ts");
  const api = fakeFetch();
  const instance = server.createTelegramBridgeServer({
    env: {
      TELEGRAM_BOT_TOKEN: VALID_TOKEN,
      HELIUS_API_KEY: "helius-test-key",
      ...envOverrides,
    },
    fetchImpl: api.fetchImpl,
  });
  try {
    await run(instance, api);
  } finally {
    await instance.close();
  }
}

test("health endpoint serves OK and JSON status without leaking the token", async () => {
  await withServer({ PORT: "0" }, async (instance) => {
    const port = await instance.listen();
    assert.ok(port > 0);

    const root = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(root.status, 200);
    assert.equal(await root.text(), "OK");

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    const payload = await health.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.config.token, "configured");
    assert.equal(JSON.stringify(payload).includes(VALID_TOKEN), false, "raw token must never appear in health output");
    assert.equal(payload.config.openRouterConfigured, false);

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(missing.status, 404);
  });
});

test("server shutdown closes idle client sockets", async () => {
  await withServer({ PORT: "0" }, async instance => {
    const port = await instance.listen();
    const socket = createConnection({ host: "127.0.0.1", port });
    let timer;
    try {
      await once(socket, "connect");
      await Promise.race([
        instance.close(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("shutdown left a socket open")), 1000); }),
      ]);
    } finally { clearTimeout(timer); socket.destroy(); }
  });
});

test("the hosted bot starts polling with the injected Telegram transport", async () => {
  await withServer({}, async (instance) => {
    const original = instance.bot;
    assert.ok(original != null);
    const status = await instance.bot.start();
    assert.equal(status.username, "hosted_bot");
    assert.equal(status.running, true);
    assert.equal(status.deepgramConfigured, false);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_MINT = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "clawd-intro-"));
  const output = path.join(temporary, `${path.basename(entry, path.extname(entry))}.mjs`);
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

test("intro copy is Clawd Bot on Solana and not the old screens", async () => {
  const product = await loadModule("clawd/shared/product.ts");
  try {
    assert.equal(product.module.INTRO_HEADING, "Clawd Bot on Solana");
    assert.match(product.module.INTRO_BODY, /Solana/);
    assert.doesNotMatch(product.module.INTRO_HEADING, /Meet Clawd Bot|Give each Bot a job|Welcome to/);
    const source = readFileSync(path.join(repoRoot, "clawd/src/components/Onboarding.tsx"), "utf8");
    const connectors = readFileSync(path.join(repoRoot, "clawd/shared/connectors.ts"), "utf8");
    assert.match(source, /INTRO_HEADING/);
    assert.match(source, /data-pump-tape/);
    assert.match(source, /Create wallet/);
    assert.match(source, /data-connector/);
    for (const name of ["Jupiter", "Phantom", "Pump.fun", "Helius", "PayBox", "lobster"]) {
      assert.match(connectors, new RegExp(`label: "${name.replace(".", "\\.")}"`));
    }
    assert.doesNotMatch(source, /Meet Clawd Bot/);
    assert.doesNotMatch(source, /Give each Bot a job/);
    assert.doesNotMatch(source, /you@example.com/);
  } finally {
    await product.dispose();
  }
});

test("each first-party connector returns a structured status and connect result", async () => {
  const loaded = await loadModule("clawd/shared/connectors.ts");
  try {
    const ids = loaded.module.CONNECTOR_IDS;
    assert.deepEqual([...ids], ["jupiter", "phantom", "pumpfun", "helius", "paybox", "lobster"]);
    for (const id of ids) {
      const empty = loaded.module.connectorStatus(id, {});
      assert.equal(empty.id, id);
      assert.equal(typeof empty.label, "string");
      assert.equal(typeof empty.configured, "boolean");
      assert.equal(typeof empty.connectUrl, "string");
      assert.equal(Array.isArray(empty.missing), true);
      const connected = loaded.module.connectConnector(id, {});
      assert.equal(typeof connected.ok, "boolean");
      assert.equal(["connected", "ready", "needs-key"].includes(connected.state), true);
      assert.equal(connected.id, id);
    }
    assert.equal(loaded.module.connectorStatus("jupiter", {}).configured, true);
    assert.equal(loaded.module.connectConnector("jupiter", {}).ok, true);
    const phantom = loaded.module.connectConnector("phantom", {});
    assert.equal(phantom.ok, false);
    assert.equal(phantom.state, "needs-key");
    const phantomReady = loaded.module.connectConnector("phantom", {
      PHANTOM_ORGANIZATION_ID: "org",
      PHANTOM_APP_ID: "app",
      PHANTOM_API_PRIVATE_KEY: "key",
    });
    assert.equal(phantomReady.ok, true);
    assert.equal(phantomReady.state, "connected");
    assert.equal(loaded.module.CONNECTORS.find((row) => row.id === "lobster").label, "lobster");
    assert.match(loaded.module.CONNECTORS.find((row) => row.id === "lobster").tagline, /Clawd/);
  } finally {
    await loaded.dispose();
  }
});

test("shipped pump tape parser stores a clawd-ws token-launch row", async () => {
  const loaded = await loadModule("clawd/server/solana/pump-tape.ts");
  try {
    const store = loaded.module.createPumpTapeStore();
    const raw = JSON.stringify({
      type: "token-launch",
      signature: "5LaunchSig",
      time: "2026-09-05T00:00:00.000Z",
      name: "Clawd Coin",
      symbol: "CLAW",
      mint: VALID_MINT,
      creator: null,
    });
    const parsed = loaded.module.parsePumpMessage(raw);
    assert.equal(parsed.type, "token-launch");
    store.apply(parsed);
    const recent = store.recent({ limit: 5 });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].name, "Clawd Coin");
    assert.equal(recent[0].symbol, "CLAW");
    assert.equal(recent[0].mint, VALID_MINT);
    assert.equal(loaded.module.DEFAULT_PUMP_WS_URL, "wss://clawd-ws.fly.dev/ws");
  } finally {
    await loaded.dispose();
  }
});

test("intro tape helper applies a token-launch JSON through the shipped parser", async () => {
  const loaded = await loadModule("clawd/src/lib/intro-tape.ts");
  try {
    const store = loaded.module.createPumpTapeStore();
    const rows = loaded.module.applyTapeJson(
      store,
      JSON.stringify({
        type: "token-launch",
        signature: "sig-intro",
        name: "Tape Coin",
        symbol: "TAPE",
        mint: VALID_MINT,
      }),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].symbol, "TAPE");
  } finally {
    await loaded.dispose();
  }
});

test("shipped local-wallet generate returns a base58 address", async () => {
  const loaded = await loadModule("clawd/server/solana/local-wallets.ts");
  const dir = await mkdtemp(path.join(os.tmpdir(), "clawd-intro-wallet-"));
  try {
    const store = loaded.module.createLocalSolanaWalletStore({
      storePath: path.join(dir, "wallets.json"),
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (plain) => Buffer.from(plain, "utf8"),
        decryptString: (buf) => buf.toString("utf8"),
      },
      randomSeed: () => Buffer.alloc(32, 9),
    });
    const created = await store.generateLocalWallet({ name: "intro" });
    assert.equal(created.name, "intro");
    assert.match(created.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    const listed = await store.listLocalWallets();
    assert.equal(listed.wallets[0].address, created.address);
  } finally {
    await loaded.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("harness health includes connectors and wallet-create returns an address", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clawd-harness-test-"));
  process.env.CLAWD_DATA_DIR = dir;
  const loaded = await loadModule("clawd/server/harness-entry.ts");
  const server = loaded.module.createHarnessServer();
  try {
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });
    const { port } = server.address();
    const health = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/api/health`, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        })
        .on("error", reject);
    });
    assert.equal(health.name, "Clawd Bot");
    assert.equal(Array.isArray(health.connectors), true);
    assert.equal(health.connectors.length, 6);
    const labels = health.connectors.map((row) => row.label);
    for (const name of ["Jupiter", "Phantom", "Pump.fun", "Helius", "PayBox", "lobster"]) {
      assert.equal(labels.includes(name), true, name);
    }
    const created = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port, path: "/api/solana/wallets/local", method: "POST", headers: { "content-type": "application/json" } },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ name: `intro-${Date.now()}` }));
    });
    assert.match(String(created.address ?? created.error ?? ""), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await loaded.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

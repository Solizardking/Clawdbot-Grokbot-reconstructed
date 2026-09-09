import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tapeSourcePath = path.join(repoRoot, "source/node-agent-coordinator/pump-tape.ts");

async function loadTape() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pump-tape-"));
  const output = path.join(temporary, "pump-tape.mjs");
  await build({
    entryPoints: [tapeSourcePath],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return {
    ...module,
    dispose: async () => {
      try { module.stopPumpTape?.(); } catch {}
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

const VALID_MINT = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";
const LAUNCH = (overrides = {}) => ({
  type: "token-launch",
  signature: `sig-${Math.random().toString(36).slice(2)}`,
  time: new Date().toISOString(),
  name: "Test Coin",
  symbol: "TEST",
  mint: VALID_MINT,
  creator: null,
  isV2: false,
  metadataUri: null,
  imageUri: null,
  description: "a test coin",
  marketCapSol: 4.2,
  website: null,
  twitter: null,
  telegram: null,
  hasGithub: false,
  githubUrls: [],
  ...overrides,
});

function fakeOpener() {
  const sockets = [];
  return {
    sockets,
    open() {
      const listeners = new Map();
      const closed = [];
      const socket = {
        listeners,
        closed,
        on(event, listener) { listeners.set(event, listener); return socket; },
        close() { closed.push(true); },
        emit(event, ...args) { listeners.get(event)?.(...args); },
      };
      sockets.push(socket);
      return socket;
    },
  };
}

test("pump tape parses exactly the solgpt.us/pump message shapes", async () => {
  const tape = await loadTape();
  try {
    assert.equal(tape.parsePumpMessage(JSON.stringify({ type: "status", connected: true, uptime: 1, totalLaunches: 0, githubLaunches: 0, clients: 0 })).type, "status");
    assert.equal(tape.parsePumpMessage(JSON.stringify(LAUNCH())).type, "token-launch");
    assert.equal(tape.parsePumpMessage(JSON.stringify({ type: "token-enriched", mint: VALID_MINT, priceUsd: 1, priceChange24hPct: null, marketCapUsd: null, liquidityUsd: null, holders: null, logoUri: null, ts: 1 })).type, "token-enriched");
    assert.equal(tape.parsePumpMessage("not json"), null);
    assert.equal(tape.parsePumpMessage(JSON.stringify({ type: "unknown" })), null);
  } finally { await tape.dispose(); }
});

test("store buffers unique launches, enrichments, and relay status with caps", async () => {
  const tape = await loadTape();
  try {
    const store = tape.createPumpTapeStore({ maxLaunches: 3 });
    for (let index = 0; index < 5; index += 1) store.apply(LAUNCH({ signature: `s${index}` }));
    store.apply(LAUNCH({ signature: "s4" }));
    assert.equal(store.recent({ limit: 50 }).length, 3);
    assert.deepEqual(store.recent().map(row => row.signature), ["s4", "s3", "s2"]);
    const enriched = { type: "token-enriched", mint: "m1", priceUsd: 0.5, priceChange24hPct: 12.5, marketCapUsd: 90_000, liquidityUsd: 30_000, holders: 42, logoUri: null, ts: 7 };
    store.apply(enriched);
    assert.deepEqual(store.enrichments(["m1", "missing"]), { m1: enriched });
    store.apply({ type: "status", connected: true, uptime: 9, totalLaunches: 100, githubLaunches: 4, clients: 2 });
    assert.equal(store.snapshot().relayStatus.totalLaunches, 100);
    assert.equal(store.snapshot().bufferedLaunches, 3);
  } finally { await tape.dispose(); }
});

test("recent and search filter the tape the way prompts ask", async () => {
  const tape = await loadTape();
  try {
    const store = tape.createPumpTapeStore();
    store.apply(LAUNCH({ signature: "a", name: "Pepe Max", symbol: "PEPE", hasGithub: true }));
    store.apply(LAUNCH({ signature: "b", name: "Dogwifhat", symbol: "WIF", description: "pepe vibes only" }));
    store.apply(LAUNCH({ signature: "c", name: "Plain", symbol: "PLN" }));
    assert.equal(store.recent({ githubOnly: true }).length, 1);
    assert.deepEqual(store.search("pepe").map(row => row.signature), ["b", "a"]);
    assert.deepEqual(store.search("PLN").map(row => row.symbol), ["PLN"]);
    assert.equal(store.search("").length, 0);
  } finally { await tape.dispose(); }
});

test("routed tool execution serves launches, search, enrichment, and rejects junk", async () => {
  const tape = await loadTape();
  try {
    const opener = fakeOpener();
    tape.ensurePumpTape({ open: opener.open });
    const store = tape.ensurePumpTape().store;
    const launch = LAUNCH({ name: "Alpha", symbol: "ALPHA", mint: VALID_MINT });
    store.apply(launch);

    const recent = await tape.executePumpRoutedTool("pump_recent_launches", { limit: 5 });
    assert.equal(recent.ok, true);
    assert.equal(recent.count, 1);
    assert.equal(recent.launches[0].pumpFunUrl, `https://pump.fun/coin/${VALID_MINT}`);

    const searched = await tape.executePumpRoutedTool("pump_search_launches", { query: "alpha" });
    assert.equal(searched.count, 1);

    await assert.rejects(tape.executePumpRoutedTool("pump_search_launches", {}), /non-empty query/);
    await assert.rejects(tape.executePumpRoutedTool("pump_token_enrichment", { mints: [] }), /at least one mint/);
    await assert.rejects(tape.executePumpRoutedTool("nope", {}), /Unknown pump tape tool/);

    const status = await tape.executePumpRoutedTool("pump_relay_status", {});
    assert.equal(status.ok, true);
    assert.equal(status.local.bufferedLaunches, 1);
    assert.ok(status.health != null);

    assert.equal(tape.isPumpRoutedTool("pump_recent_launches"), true);
    assert.equal(tape.isPumpRoutedTool("some_plugin_tool"), false);
    assert.equal(tape.PUMP_ROUTED_TOOLS.length, 4);
  } finally { await tape.dispose(); }
});

test("coordinator merges pump tools into routed tool lists and intercepts their execution", async () => {
  const routerSource = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(routerSource, /from "\.\/pump-tape\.js"/);
  assert.match(routerSource, /listTools: withLocalTools/);
  assert.match(routerSource, /isPumpRoutedTool\(name\)\) return executePumpRoutedTool/);
});

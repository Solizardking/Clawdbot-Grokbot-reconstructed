import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-solana-"));
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

function fakeSecrets(keys) {
  return async (key) => (Object.hasOwn(keys, key) ? keys[key] : null);
}

function fakeRegistry(initial = { schemaVersion: 1, wallets: [] }) {
  let value = initial;
  return {
    readRegistry: async () => value,
    writeRegistry: async (next) => { value = next; },
  };
}

const SOLANA_ADDRESS = "5XYzQ2c9T2Zy2h86mVYdGZ6cdYFe7LZAUdYc1r3sJmZK";
const OWNER = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";

test("hosted Solana data uses the user token without a local Helius key and never falls back", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  const calls = [];
  let fail = false;
  const token = 'a'.repeat(43);
  try {
    const service = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({ SAND_HOSTED_GATEWAY_URL: 'https://gateway.test', SAND_HOSTED_GATEWAY_TOKEN: token }),
      ...fakeRegistry(), loadServerSdk: async () => { throw new Error('unused'); },
      fetchImpl: async (url, init) => {
        calls.push(url);
        assert.equal(init.headers.authorization, `Bearer ${token}`);
        assert.equal(init.redirect, 'error');
        if (url.endsWith('/v1/account')) return new Response(JSON.stringify({ services: fail ? [] : ['helius'] }));
        assert.equal(url, 'https://gateway.test/helius/rpc');
        if (fail) return new Response('{"error":{"message":"Unavailable"}}', { status: 503 });
        return new Response(JSON.stringify({ jsonrpc: '2.0', result: { id: OWNER } }));
      },
    });
    assert.equal((await service.getStatus()).heliusConfigured, true);
    await service.getAsset({ id: OWNER });
    fail = true;
    assert.equal((await service.getStatus()).heliusConfigured, false);
    await assert.rejects(service.getAsset({ id: OWNER }), /Unavailable/);
    assert.ok(calls.every(url => url.startsWith('https://gateway.test/')));
  } finally { await loaded.dispose(); }
});

function fakeSdkModule(calls = []) {
  return {
    ServerSDK: class {
      constructor(options) { calls.push(["construct", options.organizationId, options.appId]); }
      async createWallet(name) {
        calls.push(["createWallet", name]);
        return { walletId: "wal_123", addresses: [
          { addressType: "Solana", address: SOLANA_ADDRESS },
          { addressType: "Ethereum", address: "0xabc" },
        ] };
      }
      async getWallets(limit, offset) { calls.push(["getWallets", limit, offset]); return { totalCount: 0, wallets: [] }; }
      async getWalletAddresses(walletId) { calls.push(["getAddresses", walletId]); return []; }
    },
  };
}

test("solana status reports which credentials are configured", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const empty = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({}),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
    });
    const none = await empty.getStatus();
    assert.equal(none.phantomConfigured, false);
    assert.equal(none.heliusConfigured, false);
    assert.equal(none.missingPhantom.length, 3);
    const partial = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({ PHANTOM_ORGANIZATION_ID: "org", PHANTOM_APP_ID: "app", PHANTOM_API_PRIVATE_KEY: "key", HELIUS_API_KEY: "hel" }),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
    });
    const full = await partial.getStatus();
    assert.equal(full.phantomConfigured, true);
    assert.equal(full.heliusConfigured, true);
    assert.deepEqual(full.missingPhantom, []);
  } finally { await loaded.dispose(); }
});

test("createWallet validates the name and persists the Solana record", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const calls = [];
    const registry = fakeRegistry();
    const secrets = { PHANTOM_ORGANIZATION_ID: "org", PHANTOM_APP_ID: "app", PHANTOM_API_PRIVATE_KEY: "key" };
    const service = loaded.module.createSolanaService({
      revealSecret: fakeSecrets(secrets),
      readRegistry: registry.readRegistry,
      writeRegistry: registry.writeRegistry,
      loadServerSdk: async () => fakeSdkModule(calls),
    });
    await assert.rejects(service.createWallet({ name: "   " }), /needs a name/);
    const wallet = await service.createWallet({ name: "  treasury   2026 " });
    assert.equal(wallet.name, "treasury 2026");
    assert.equal(wallet.walletId, "wal_123");
    assert.equal(wallet.solanaAddress, SOLANA_ADDRESS);
    const construct = calls.find(([kind]) => kind === "construct");
    assert.deepEqual(construct, ["construct", "org", "app"]);
    const listed = await service.listWallets();
    assert.equal(listed.wallets.length, 1);
    assert.equal(listed.wallets[0].solanaAddress, SOLANA_ADDRESS);
  } finally { await loaded.dispose(); }
});

test("createWallet refuses to run without Phantom credentials", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const service = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({}),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
    });
    await assert.rejects(service.createWallet({ name: "x" }), /not configured/);
  } finally { await loaded.dispose(); }
});

test("getWalletAssets queries Helius getAssetsByOwner with bounded options", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const seen = [];
    const make = (module) => module.createSolanaService({
      revealSecret: fakeSecrets({ HELIUS_API_KEY: "hel-key" }),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
      fetchImpl: async (url, options) => {
        seen.push({ url, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { total: 1, items: [{ id: "mint", ownership: { owner: OWNER } }] } }), { status: 200 });
      },
      heliusRpcBase: "https://mainnet.helius-rpc.com/",
    });
    const service = make(loaded.module);
    await assert.rejects(service.getWalletAssets({ ownerAddress: "not-an-address" }), /valid Solana owner/);
    const result = await service.getWalletAssets({ ownerAddress: OWNER, limit: 500 });
    assert.equal(result.items.length, 1);
    assert.equal(seen.length, 1);
    assert.ok(seen[0].url.startsWith("https://mainnet.helius-rpc.com/?api-key=hel-key"));
    assert.equal(seen[0].body.method, "getAssetsByOwner");
    assert.equal(seen[0].body.params.ownerAddress, OWNER);
    assert.equal(seen[0].body.params.limit, 100);
    assert.equal(seen[0].body.params.options.showFungible, true);
  } finally { await loaded.dispose(); }
});

test("getAsset surfaces Helius rpc errors and validates ids", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const service = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({ HELIUS_API_KEY: "hel-key" }),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
      fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", error: { code: -32004, message: "The requested asset was not found." } }), { status: 404 }),
    });
    await assert.rejects(service.getAsset({ id: "zzz" }), /valid Solana asset id/);
    await assert.rejects(service.getAsset({ id: OWNER }), /not found/);
  } finally { await loaded.dispose(); }
});

test("searchAssets clamps limits and validates the token type", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const seen = [];
    const service = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({ HELIUS_API_KEY: "hel-key" }),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
      fetchImpl: async (url, options) => {
        seen.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { total: 0, items: [] } }), { status: 200 });
      },
    });
    await assert.rejects(service.searchAssets({ ownerAddress: "nope" }), /valid Solana owner/);
    await service.searchAssets({ ownerAddress: OWNER, tokenType: "everything", limit: 9999 });
    assert.equal(seen[0].params.tokenType, "all");
    assert.equal(seen[0].params.limit, 100);
  } finally { await loaded.dispose(); }
});

test("DAS methods fail closed without HELIUS_RPC_URL or HELIUS_API_KEY", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const service = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({}),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
      fetchImpl: async () => { throw new Error("network must not be used"); },
    });
    await assert.rejects(service.getAsset({ id: OWNER }), /HELIUS_RPC_URL or HELIUS_API_KEY/);
    await assert.rejects(service.getWalletAssets({ ownerAddress: OWNER }), /HELIUS_RPC_URL or HELIUS_API_KEY/);
    await assert.rejects(service.searchAssets({ ownerAddress: OWNER }), /HELIUS_RPC_URL or HELIUS_API_KEY/);
  } finally { await loaded.dispose(); }
});

test("DAS getAsset/searchAssets/getAssetsByOwner POST to HELIUS_RPC_URL and parse is_agent fields", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const seen = [];
    const rpcUrl = "https://injected-helius.example/rpc";
    const service = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({}),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
      envHeliusRpcUrl: rpcUrl,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        seen.push({ url, method: body.method, params: body.params });
        if (body.method === "getAsset") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { id: OWNER, is_agent: true, asset_signer: "Signer1111111111111111111111111111111111", agent_token: "Token11111111111111111111111111111111111" } }), { status: 200 });
        }
        if (body.method === "searchAssets") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { total: 1, items: [{ id: OWNER, isAgent: true, assetSigner: "Signer1111111111111111111111111111111111" }] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { total: 1, items: [{ id: OWNER, is_agent: false }], nativeBalance: { lamports: 2_000_000_000 } } }), { status: 200 });
      },
    });
    const asset = await service.getAsset({ id: OWNER });
    assert.equal(seen[0].url, rpcUrl);
    assert.equal(seen[0].method, "getAsset");
    assert.equal(asset.is_agent, true);
    assert.equal(asset.asset_signer, "Signer1111111111111111111111111111111111");
    assert.equal(asset.agent_token, "Token11111111111111111111111111111111111");
    const searched = await service.searchAssets({ isAgent: true, agentToken: OWNER, assetSigner: OWNER, limit: 3 });
    assert.equal(seen[1].url, rpcUrl);
    assert.equal(seen[1].method, "searchAssets");
    assert.equal(seen[1].params.isAgent, true);
    assert.equal(seen[1].params.agentToken, OWNER);
    assert.equal(seen[1].params.assetSigner, OWNER);
    assert.equal(searched.items[0].is_agent, true);
    assert.equal(searched.items[0].asset_signer, "Signer1111111111111111111111111111111111");
    const wallet = await service.getWalletAssets({ ownerAddress: OWNER });
    assert.equal(seen[2].method, "getAssetsByOwner");
    assert.equal(wallet.items[0].is_agent, false);
    assert.equal(wallet.nativeBalance.lamports, 2_000_000_000);
  } finally { await loaded.dispose(); }
});

test("helius key falls back to the environment when the secret is absent", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const seen = [];
    const service = loaded.module.createSolanaService({
      revealSecret: fakeSecrets({}),
      ...fakeRegistry(),
      loadServerSdk: async () => fakeSdkModule(),
      fetchImpl: async (url) => { seen.push(url); return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { items: [] } }), { status: 200 }); },
      envHeliusKey: "env-key",
    });
    await service.getAsset({ id: OWNER });
    assert.ok(seen[0].includes("api-key=env-key"));
  } finally { await loaded.dispose(); }
});

async function makeStage() {
  const stage = await mkdtemp(path.join(os.tmpdir(), "grok-stage-"));
  const assets = path.join(stage, "dist", "renderer", "assets");
  await mkdir(assets, { recursive: true });
  const entry = `const x=1;${"y".repeat(40)};export default x;`;
  const entryFile = path.join(assets, "index-TESTENTRY.js");
  await writeFile(entryFile, `async upsertSecrets(e,t){}\ntitle:"Meet Grok Bot"\ntitle:"Grok Bot is Paused"\n${entry}`);
  await writeFile(path.join(assets, "other.js"), 'const unrelated = "Grok Bot agents";const more = 1;');
  await mkdir(path.join(stage, "dist", "renderer"), { recursive: true });
  await writeFile(path.join(stage, "dist", "renderer", "index.html"), "<!doctype html><html><head><title>Grok Bot</title></head></html>");
  return { stage, assets, entryFile };
}

test("solana mode patch appends the runtime once and writes provenance", async () => {
  const patch = await import(`${pathToFileURL(path.join(repoRoot, "scripts/lib/solana-mode-patch.mjs")).href}`);
  const { stage, entryFile } = await makeStage();
  try {
    const record = await patch.applyOriginalRendererSolanaModePatch({ stageRoot: stage });
    assert.equal(record.chunks.length, 1);
    assert.equal(record.features.length, 8);
    const patched = await (await import("node:fs/promises")).readFile(entryFile, "utf8");
    assert.equal(patched.split("__sandSolanaModeInstalled").length - 1, 2);
    assert.ok(patched.includes("#sand-solana-button"));
    assert.ok(patched.includes("#9945FF"));
    assert.ok(patched.includes("#14F195"));
    assert.ok(patched.includes("getWalletAssets"));
    assert.ok(patched.includes("generateLocalWallet"));
    assert.ok(patched.includes("OWS wallet password"));
    assert.ok(patched.includes('type: "password"'));
    assert.ok(patched.includes("window.desktop.ows"));
    assert.ok(patched.includes("api.createWallet({ name: name, password: password"));
    assert.ok(record.features.includes("ows-masked-password"));
    assert.ok(patched.includes('title:"Meet Clawd Bot"'));
    assert.equal(patched.includes('title:"Meet Grok Bot"'), false);
    assert.equal(patched.includes('title:"Clawd Bot is Paused"'), true);
    assert.ok(patched.includes("sand-solana-tagline"));
    assert.ok(patched.includes("powered by Grok and xAI on Solana"));
    const other = await (await import("node:fs/promises")).readFile(path.join(stage, "dist", "renderer", "assets", "other.js"), "utf8");
    assert.equal(other.includes("Clawd Bot agents"), true);
    const indexHtml = await (await import("node:fs/promises")).readFile(path.join(stage, "dist", "renderer", "index.html"), "utf8");
    assert.equal(indexHtml.includes("<title>Clawd Bot</title>"), true);
    const rebrandRows = record.rebrand.sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(rebrandRows.map(({ path, replacements }) => ({ path, replacements })), [
      { path: "dist/renderer/assets/index-TESTENTRY.js", replacements: 2 },
      { path: "dist/renderer/assets/other.js", replacements: 1 },
      { path: "dist/renderer/index.html", replacements: 1 },
    ]);
    const chunkPaths = new Set(record.chunks.map(chunk => chunk.path));
    for (const row of rebrandRows.filter(row => !chunkPaths.has(row.path))) {
      const actual = await (await import("node:fs/promises")).readFile(path.join(stage, row.path));
      assert.equal(row.patched.bytes, actual.byteLength, `rebrand hash drift at ${row.path}`);
      assert.equal(row.patched.sha256, createHash("sha256").update(actual).digest("hex"), `rebrand hash drift at ${row.path}`);
    }
    assert.equal(record.indexHtmlReplacements, 1);
    const provenance = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(stage, "dist", "renderer-solana-extension.json"), "utf8"));
    assert.equal(provenance.mode, "original-renderer-solana-mode");
    await assert.rejects(patch.applyOriginalRendererSolanaModePatch({ stageRoot: stage }), /already installed/);
  } finally { await rm(stage, { recursive: true, force: true }); }
});

test("solana mode patch fails closed without a unique entry anchor", async () => {
  const patch = await import(`${pathToFileURL(path.join(repoRoot, "scripts/lib/solana-mode-patch.mjs")).href}`);
  const { stage, assets } = await makeStage();
  try {
    await writeFile(path.join(assets, "index-SECOND.js"), "async upsertSecrets(e,t){} and upsertSecrets again {}");
    await assert.rejects(patch.applyOriginalRendererSolanaModePatch({ stageRoot: stage }), /entry chunk/);
  } finally { await rm(stage, { recursive: true, force: true }); }
});

test("solana mode patch fails closed when the onboarding heading anchor is missing", async () => {
  const patch = await import(`${pathToFileURL(path.join(repoRoot, "scripts/lib/solana-mode-patch.mjs")).href}`);
  const { stage, entryFile } = await makeStage();
  try {
    await writeFile(entryFile, "async upsertSecrets(e,t){}\nconst noHeadingHere = 1;");
    await assert.rejects(patch.applyOriginalRendererSolanaModePatch({ stageRoot: stage }), /Clawd rebrand could not be verified/);
  } finally { await rm(stage, { recursive: true, force: true }); }
});

async function loadWalletModule() {
  return await loadModule("source/electron-main/solana/local-wallets.ts");
}

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer) => Buffer.from(buffer.toString("utf8"), "utf8").toString("utf8").slice("enc:".length),
  };
}

const RFC8032_SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const RFC8032_PUB = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");

test("solanaKeypairFromSeed matches the RFC 8032 Ed25519 test vector", async () => {
  const loaded = await loadWalletModule();
  try {
    const bs58 = (await import("bs58")).default;
    const pair = loaded.module.solanaKeypairFromSeed(RFC8032_SEED);
    assert.equal(pair.address, bs58.encode(RFC8032_PUB));
    const secret = Buffer.from(bs58.decode(pair.secretKeyBase58));
    assert.equal(secret.length, 64);
    assert.ok(secret.subarray(0, 32).equals(RFC8032_SEED));
    assert.ok(secret.subarray(32).equals(RFC8032_PUB));
    assert.throws(() => loaded.module.solanaKeypairFromSeed(Buffer.alloc(16)), /32 bytes/);
  } finally { await loaded.dispose(); }
});

test("local wallet store generates, lists and reveals encrypted wallets", async () => {
  const loaded = await loadWalletModule();
  try {
    const storePath = path.join(os.tmpdir(), `grok-wallets-${Date.now()}-${process.pid}.json`);
    try {
      const store = loaded.module.createLocalSolanaWalletStore({
        safeStorage: fakeSafeStorage(),
        storePath,
        randomSeed: () => RFC8032_SEED,
        now: () => new Date(0),
      });
      await assert.rejects(store.generateLocalWallet({ name: "  " }), /needs a name/);
      const wallet = await store.generateLocalWallet({ name: "onboarding" });
      assert.equal(wallet.name, "onboarding");
      assert.equal(wallet.address, (await import("bs58")).default.encode(RFC8032_PUB));
      assert.equal(wallet.createdAt, new Date(0).toISOString());
      await assert.rejects(store.generateLocalWallet({ name: "onboarding" }), /already exists/);
      const raw = await (await import("node:fs/promises")).readFile(storePath, "utf8");
      assert.equal(raw.includes("9d61b19d"), false, "raw seed must never be persisted");
      const listed = await store.listLocalWallets();
      assert.equal(listed.wallets.length, 1);
      assert.equal(listed.wallets[0].secret, undefined);
      const secret = await store.revealLocalWalletSecret({ name: "onboarding" });
      const bs58 = (await import("bs58")).default;
      assert.equal(bs58.decode(secret).length, 64);
      await assert.rejects(store.revealLocalWalletSecret({ name: "missing" }), /No local wallet/);
    } finally { await rm(storePath, { force: true }); }
  } finally { await loaded.dispose(); }
});

test("local wallet store refuses to operate without OS secure storage", async () => {
  const loaded = await loadWalletModule();
  try {
    const storePath = path.join(os.tmpdir(), `grok-wallets-unavail-${process.pid}.json`);
    try {
      const working = loaded.module.createLocalSolanaWalletStore({
        safeStorage: fakeSafeStorage(),
        storePath,
        randomSeed: () => RFC8032_SEED,
      });
      await working.generateLocalWallet({ name: "x" });
      const store = loaded.module.createLocalSolanaWalletStore({
        safeStorage: fakeSafeStorage(false),
        storePath,
      });
      await assert.rejects(store.generateLocalWallet({ name: "y" }), /secure storage is unavailable/);
      await assert.rejects(store.revealLocalWalletSecret({ name: "x" }), /secure storage is unavailable/);
    } finally { await rm(storePath, { force: true }); }
  } finally { await loaded.dispose(); }
});

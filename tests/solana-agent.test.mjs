import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import bs58 from "bs58";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity } from "@metaplex-foundation/umi";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RFC8032_SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const RFC8032_PUB = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");
const SECRET = bs58.encode(Buffer.concat([RFC8032_SEED, RFC8032_PUB]));
const HELIUS = "https://mainnet.helius-rpc.com/?api-key=test-helius";
const ASSET = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";
const SIG = bs58.encode(Buffer.alloc(64, 1));

async function loadModule(entry, externals = []) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-solana-agent-"));
  const output = path.join(temporary, `${path.basename(entry, ".ts")}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    external: externals,
    banner: { js: `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);` },
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function dummyUmiTx(secret = SECRET) {
  const umi = createUmi("https://example.invalid");
  const keypair = umi.eddsa.createKeypairFromSecretKey(bs58.decode(secret));
  umi.use(keypairIdentity(keypair));
  const tx = umi.transactions.create({
    payer: umi.identity.publicKey,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 999n,
    instructions: [],
  });
  return Buffer.from(umi.transactions.serialize(tx)).toString("base64");
}

function httpJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function jsonRpc(result) {
  return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: "sand-solana-agent", result }) };
}

function createSdkFetch(calls, options = {}) {
  const unsigned = options.unsignedTx ?? dummyUmiTx();
  const helius = options.helius ?? HELIUS;
  return async (url, init) => {
    const href = String(url);
    const body = init?.body == null ? null : JSON.parse(init.body);
    calls.push({ url: href, method: body?.method ?? init?.method, body });
    assert.equal(href.includes("api.mainnet-beta.solana.com"), false);
    if (href.includes("/v1/agents/mint")) {
      return httpJson({ success: true, tx: unsigned, blockhash: { blockhash: BLOCKHASH, lastValidBlockHeight: 999 }, assetAddress: ASSET });
    }
    if (href.includes("/v1/launches/create")) {
      return httpJson({
        success: true,
        transactions: [unsigned],
        blockhash: { blockhash: BLOCKHASH, lastValidBlockHeight: 999 },
        mintAddress: ASSET,
        genesisAccount: ASSET,
      });
    }
    if (href.includes("/v1/launches/register")) {
      return httpJson({
        success: true,
        existing: false,
        launch: { id: "launch-1", link: "https://www.metaplex.com/launch/test" },
        token: { id: "token-1", mintAddress: ASSET },
      });
    }
    const method = body?.method;
    const id = body?.id == null ? "1" : String(body.id);
    const rpc = result => httpJson({ jsonrpc: "2.0", id, result });
    const rpcCtx = value => rpc({ context: { slot: 1 }, value });
    if (method === "getLatestBlockhash") return rpcCtx({ blockhash: BLOCKHASH, lastValidBlockHeight: 999 });
    if (method === "sendTransaction") return rpc(SIG);
    if (method === "getSignatureStatuses") {
      const n = Array.isArray(body?.params?.[0]) ? body.params[0].length : 1;
      return rpcCtx(Array.from({ length: n }, () => ({ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" })));
    }
    if (method === "getBlockHeight" || method === "getSlot") return rpc(1);
    if (method === "getAccountInfo") {
      const value = typeof options.accountInfo === "function" ? options.accountInfo(body.params[0]) : null;
      return rpcCtx(value);
    }
    if (method === "getMultipleAccounts" || method === "getMultipleAccountsInfo") {
      const n = Array.isArray(body?.params?.[0]) ? body.params[0].length : 1;
      return rpcCtx(Array.from({ length: n }, () => null));
    }
    if (method === "getBalance") return rpcCtx(1_000_000_000);
    if (method === "getMinimumBalanceForRentExemption") return rpc(890880);
    if (method === "simulateTransaction") return rpcCtx({ err: null, logs: [], unitsConsumed: 1, accounts: null, returnData: null });
    if (method === "getRecentPrioritizationFees") return rpc([]);
    if (method === "getAsset" || method === "searchAssets" || method === "getAssetsByOwner") {
      return rpc({
        id: ASSET,
        is_agent: true,
        asset_signer: "Signer1111111111111111111111111111111111",
        agent_token: null,
        items: [{ id: ASSET, is_agent: true, asset_signer: "Signer1111111111111111111111111111111111" }],
        nativeBalance: { lamports: 1_000_000_000 },
        total: 1,
      });
    }
    throw new Error(`unexpected ${href} ${method}`);
  };
}

test("versioned Solana messages sign with the fee payer as the first account key", async () => {
  const sign = await loadModule("source/electron-main/solana/solana-tx-sign.ts");
  try {
    const keypair = sign.module.keypairFromSecret(SECRET);
    const payer = Buffer.from(bs58.decode(keypair.publicKey));
    const v0 = Buffer.concat([
      Buffer.from([1]),
      Buffer.alloc(64),
      Buffer.from([0x80, 1, 0, 0, 1]),
      payer,
      Buffer.alloc(32),
      Buffer.from([0]),
    ]).toString("base64");
    const signed = sign.module.signVersionedTransaction(v0, SECRET);
    assert.equal(signed.signer, keypair.publicKey);
    const parsed = sign.module.parseVersionedTransaction(signed.signedTransaction);
    assert.equal(parsed.firstAccountKey, keypair.publicKey);
    assert.equal(parsed.numRequiredSignatures, 1);
  } finally { await sign.dispose(); }
});

test("agent PDAs are stable, off-curve, and use the Metaplex program IDs", async () => {
  const loaded = await loadModule("source/shared/solana-agent-pdas.ts");
  try {
    const pdas = loaded.module;
    const identity = pdas.findAgentIdentityV1Pda(ASSET);
    const again = pdas.findAgentIdentityV1Pda(ASSET);
    assert.equal(identity.address, again.address);
    assert.equal(identity.address.length >= 32, true);
    assert.equal(pdas.isEd25519OnCurve(bs58.decode(identity.address)), false);
    const profile = pdas.findExecutiveProfileV1Pda(ASSET);
    const delegate = pdas.findExecutionDelegateRecordV1Pda(profile.address, ASSET);
    const wallet = pdas.findAssetSignerPda(ASSET);
    assert.notEqual(identity.address, profile.address);
    assert.notEqual(delegate.address, wallet.address);
    assert.equal(pdas.MPL_AGENT_IDENTITY_PROGRAM_ID, "1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p");
    assert.equal(pdas.MPL_AGENT_TOOLS_PROGRAM_ID, "TLREGni9ZEyGC3vnPZtqUh95xQ8oPqJSvNjvB7FGK8S");
  } finally { await loaded.dispose(); }
});

test("solana_agent_mint calls mintAndSubmitAgent then submits through HELIUS_RPC_URL", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/solana-agent-tools.ts");
  const sign = await loadModule("source/electron-main/solana/solana-tx-sign.ts");
  try {
    const payer = sign.module.keypairFromSecret(SECRET).publicKey;
    const unsigned = dummyUmiTx();
    const calls = [];
    const port = {
      fetchImpl: createSdkFetch(calls, { unsignedTx: unsigned }),
      heliusRpcUrl: async () => HELIUS,
      revealLocalWalletSecret: async ({ name }) => {
        assert.equal(name, "treasury");
        return SECRET;
      },
    };
    assert.equal("sendAgentTools" in port, false);
    const tools = loaded.module.solanaAgentRoutedTools({ HELIUS_RPC_URL: HELIUS });
    assert.ok(tools.some(tool => tool.name === "solana_agent_mint"));
    assert.ok(tools.some(tool => tool.name === "solana_agent_register_identity"));
    assert.ok(tools.some(tool => tool.name === "solana_agent_register_executive"));
    assert.ok(tools.some(tool => tool.name === "solana_agent_delegate_execution"));

    const result = await loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_mint", {
      wallet_name: "treasury",
      name: "My AI Agent",
      uri: "https://example.com/agent-metadata.json",
      description: "An autonomous trading agent",
      services: [{ name: "trading", endpoint: "https://myagent.ai/trade" }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.rpcUrl, HELIUS);
    assert.equal(result.assetAddress, ASSET);
    assert.equal(result.signature, SIG);
    assert.match(result.identityPda, /^[1-9A-HJ-NP-Za-km-z]+$/);
    const mintCall = calls.find(call => String(call.url) === "https://api.metaplex.com/v1/agents/mint");
    assert.ok(mintCall);
    assert.equal(mintCall.body.wallet, payer);
    assert.equal(mintCall.body.network, "solana-mainnet");
    assert.equal(mintCall.body.agentMetadata.type, "agent");
    assert.equal(mintCall.body.agentMetadata.name, "My AI Agent");
    const sends = calls.filter(call => call.body?.method === "sendTransaction");
    assert.ok(sends.length >= 1);
    assert.ok(sends.every(call => call.url === HELIUS));
    assert.equal(typeof sends[0].body.params[0], "string");
    assert.notEqual(sends[0].body.params[0], unsigned);
    assert.equal(calls.some(call => String(call.url).includes("api.mainnet-beta.solana.com")), false);
  } finally {
    await loaded.dispose();
    await sign.dispose();
  }
});

test("solana_agent_search and verify_delegation call Helius DAS/getAccountInfo with derived PDAs", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/solana-agent-tools.ts");
  const pdas = await loadModule("source/shared/solana-agent-pdas.ts");
  try {
    const profile = pdas.module.findExecutiveProfileV1Pda(ASSET);
    const delegate = pdas.module.findExecutionDelegateRecordV1Pda(profile.address, ASSET);
    const calls = [];
    const port = {
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body });
        assert.equal(url, HELIUS);
        if (body.method === "searchAssets") {
          assert.equal(body.params.isAgent, true);
          assert.equal(body.params.interface, "MplCoreAsset");
          return jsonRpc({ total: 1, items: [{ id: ASSET, is_agent: true, asset_signer: "Signer1111111111111111111111111111111111" }] });
        }
        if (body.method === "getAccountInfo") {
          assert.equal(body.params[0], delegate.address);
          return jsonRpc({ value: { lamports: 1 } });
        }
        throw new Error(body.method);
      },
      heliusRpcUrl: async () => HELIUS,
    };
    const search = await loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_search", { limit: 5 });
    assert.equal(search.items[0].isAgent, true);
    assert.equal(search.rpcUrl, HELIUS);
    const verify = await loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_verify_delegation", {
      agent_asset: ASSET,
      executive_authority: ASSET,
    });
    assert.equal(verify.delegated, true);
    assert.equal(verify.executionDelegateRecord, delegate.address);
    assert.equal(verify.rpcUrl, HELIUS);
  } finally {
    await loaded.dispose();
    await pdas.dispose();
  }
});

test("registerIdentity/executive/delegate/revoke drive defaultSendAgentTools on HELIUS_RPC_URL", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/solana-agent-tools.ts");
  try {
    const calls = [];
    const port = {
      fetchImpl: createSdkFetch(calls),
      heliusRpcUrl: async () => HELIUS,
      revealLocalWalletSecret: async () => SECRET,
    };
    assert.equal("sendAgentTools" in port, false);
    const identity = await loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_register_identity", {
      wallet_name: "ops",
      asset: ASSET,
      agent_registration_uri: "https://example.com/agent-registration.json",
    });
    assert.equal(identity.signature, SIG);
    assert.equal(identity.rpcUrl, HELIUS);
    const registered = await loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_register_executive", { wallet_name: "ops" });
    assert.equal(registered.signature, SIG);
    assert.equal(registered.rpcUrl, HELIUS);
    const delegated = await loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_delegate_execution", {
      wallet_name: "ops",
      agent_asset: ASSET,
    });
    assert.equal(delegated.signature, SIG);
    const revoked = await loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_revoke_execution", {
      wallet_name: "ops",
      agent_asset: ASSET,
      executive_authority: ASSET,
    });
    assert.equal(revoked.signature, SIG);
    const sends = calls.filter(call => call.body?.method === "sendTransaction");
    assert.equal(sends.length, 4);
    assert.ok(sends.every(call => call.url === HELIUS));
    assert.ok(calls.some(call => call.body?.method === "getLatestBlockhash"));
    assert.ok(calls.some(call => call.body?.method === "getSignatureStatuses"));
    assert.equal(calls.some(call => String(call.url).includes("api.mainnet-beta.solana.com")), false);
  } finally { await loaded.dispose(); }
});

test("solana_agent_launch_token requires an Irys image and uses createAndRegisterLaunch on Helius", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/solana-agent-tools.ts");
  try {
    const calls = [];
    const port = {
      fetchImpl: createSdkFetch(calls),
      heliusRpcUrl: async () => HELIUS,
      revealLocalWalletSecret: async () => SECRET,
    };
    assert.equal("sendAgentTools" in port, false);
    await assert.rejects(loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_launch_token", {
      wallet_name: "ops", agent_asset: ASSET, name: "AGT", symbol: "AGT", image: "https://example.com/not-irys.png",
    }), /Irys/);
    const result = await loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_launch_token", {
      wallet_name: "ops", agent_asset: ASSET, name: "AGT", symbol: "AGT", image: "https://gateway.irys.xyz/abc",
    });
    assert.equal(result.ok, true);
    assert.equal(result.rpcUrl, HELIUS);
    assert.equal(result.mintAddress, ASSET);
    assert.equal(result.signature, SIG);
    assert.equal(result.launch.link, "https://www.metaplex.com/launch/test");
    const createCall = calls.find(call => String(call.url) === "https://api.metaplex.com/v1/launches/create");
    assert.ok(createCall);
    assert.equal(createCall.body.agent.mint, ASSET);
    assert.equal(createCall.body.agent.setToken, false);
    assert.equal(createCall.body.launch.image.startsWith("https://gateway.irys.xyz/"), true);
    assert.equal(createCall.body.launch.type, "bondingCurve");
    const registerCall = calls.find(call => String(call.url) === "https://api.metaplex.com/v1/launches/register");
    assert.ok(registerCall);
    const sends = calls.filter(call => call.body?.method === "sendTransaction");
    assert.ok(sends.length >= 1);
    assert.ok(sends.every(call => call.url === HELIUS));
    assert.equal(calls.some(call => String(call.url).includes("/v1/genesis/launches")), false);
    assert.equal(calls.some(call => String(call.url).includes("api.mainnet-beta.solana.com")), false);
  } finally {
    await loaded.dispose();
  }
});

test("coordinator and production surfaces register the agent tools on the Helius path", async () => {
  const router = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(router, /from "\.\/solana-agent-tools\.js"/);
  assert.match(router, /\.\.\.solanaAgentRoutedTools\(\)/);
  assert.match(router, /isSolanaAgentRoutedTool\(name\)\) return executeSolanaAgentRoutedTool/);
  assert.match(router, /\.\.\.clawdGatewayRoutedTools\(\)/);
  assert.match(router, /\.\.\.cloudBoxRoutedTools\(\)/);
  const services = await readFile(path.join(repoRoot, "source/electron-main/main-production-services.ts"), "utf8");
  assert.match(services, /SOLANA_AGENT_ROUTED_TOOLS/);
  assert.match(services, /executeSolanaAgentRoutedTool\(solanaAgentPort/);
  assert.match(services, /envHeliusRpcUrl: env\.HELIUS_RPC_URL/);
  assert.match(services, /e2bRoutedTools\(\)/);
  assert.match(services, /browserUseRoutedTools\(\)/);
  const bridge = await readFile(path.join(repoRoot, "source/telegram-bridge-server/main.ts"), "utf8");
  assert.match(bridge, /HELIUS_RPC_URL/);
  assert.match(bridge, /isSolanaAgentRoutedTool/);
  const source = await readFile(path.join(repoRoot, "source/node-agent-coordinator/solana-agent-tools.ts"), "utf8");
  assert.match(source, /METAPLEX_API_BASE/);
  assert.match(source, /mintAndSubmitAgent/);
  assert.match(source, /createAndRegisterLaunch/);
  assert.match(source, /registerIdentityV1/);
  assert.match(source, /registerExecutiveV1/);
  assert.match(source, /delegateExecutionV1/);
  assert.match(source, /revokeExecutionV1/);
  assert.match(source, /createHeliusUmi/);
  assert.match(source, /createUmi\(connection\)/);
  assert.doesNotMatch(source, /api\.mainnet-beta\.solana\.com/);
  const pdas = await readFile(path.join(repoRoot, "source/shared/solana-agent-pdas.ts"), "utf8");
  assert.match(pdas, /https:\/\/api\.metaplex\.com/);
});

test("agent tools fail closed when Helius is not configured", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/solana-agent-tools.ts");
  try {
    const port = {
      fetchImpl: async () => { throw new Error("network must not be used"); },
      heliusRpcUrl: async () => { throw new Error("Helius is not configured. Set HELIUS_RPC_URL or HELIUS_API_KEY (env or Settings → Solana panel)."); },
    };
    await assert.rejects(loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_read", { asset: ASSET }), /HELIUS_RPC_URL or HELIUS_API_KEY/);
    await assert.rejects(loaded.module.executeSolanaAgentRoutedTool(port, "solana_agent_mint", {
      wallet_name: "ops", name: "A", uri: "https://example.com/a.json", description: "d",
    }), /HELIUS_RPC_URL or HELIUS_API_KEY/);
  } finally { await loaded.dispose(); }
});

test("solana service prefers HELIUS_RPC_URL over constructing the default Helius host", async () => {
  const loaded = await loadModule("source/electron-main/solana/solana-service.ts");
  try {
    const seen = [];
    const service = loaded.module.createSolanaService({
      revealSecret: async () => null,
      readRegistry: async () => ({ schemaVersion: 1, wallets: [] }),
      writeRegistry: async () => {},
      loadServerSdk: async () => ({ ServerSDK: class {} }),
      envHeliusRpcUrl: "https://custom-helius.example/rpc",
      fetchImpl: async (url, options) => {
        seen.push({ url, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: { id: ASSET, is_agent: true } }), { status: 200 });
      },
    });
    const status = await service.getStatus();
    assert.equal(status.heliusConfigured, true);
    await service.getAsset({ id: ASSET });
    assert.equal(seen[0].url, "https://custom-helius.example/rpc");
    assert.equal(seen[0].body.method, "getAsset");
    const searched = await service.searchAssets({ isAgent: true, limit: 3 });
    assert.equal(seen[1].body.params.isAgent, true);
    assert.equal(searched.is_agent, true);
  } finally { await loaded.dispose(); }
});

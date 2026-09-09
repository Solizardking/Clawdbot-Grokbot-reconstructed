/**
 * Fresh-consumer import of the shipped Solana agent + DAS entries.
 * Not the unit-test file internals: esbuild-loads the source modules, then
 * runs mint / registerIdentity / executive / Genesis / DAS twice through
 * defaultSendAgentTools (sendAgentTools is left unset).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import bs58 from "bs58";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity } from "@metaplex-foundation/umi";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELIUS = "https://injected-helius.example/rpc";
const RFC8032_SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const RFC8032_PUB = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");
const SECRET = bs58.encode(Buffer.concat([RFC8032_SEED, RFC8032_PUB]));
const ASSET = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";
const SIG = bs58.encode(Buffer.alloc(64, 1));

async function load(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-agent-consumer-"));
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

function dummyUmiTx() {
  const umi = createUmi("https://example.invalid");
  const keypair = umi.eddsa.createKeypairFromSecretKey(bs58.decode(SECRET));
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

async function runOnce(agent, sign, serviceMod, pdas, label) {
  const payer = sign.keypairFromSecret(SECRET).publicKey;
  const unsigned = dummyUmiTx();
  const profile = pdas.findExecutiveProfileV1Pda(payer);
  const delegate = pdas.findExecutionDelegateRecordV1Pda(profile.address, ASSET);
  const calls = [];
  let delegated = false;
  const fetchImpl = async (url, init) => {
    const href = String(url);
    const body = init.body == null ? null : JSON.parse(init.body);
    calls.push({ url: href, method: body?.method ?? init.method, body });
    assert.equal(href.includes("api.mainnet-beta.solana.com"), false, `${label} hit public RPC`);
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
    if (href === HELIUS && method === "getLatestBlockhash") return rpcCtx({ blockhash: BLOCKHASH, lastValidBlockHeight: 999 });
    if (href === HELIUS && method === "sendTransaction") return rpc(SIG);
    if (href === HELIUS && method === "getSignatureStatuses") {
      const n = Array.isArray(body?.params?.[0]) ? body.params[0].length : 1;
      return rpcCtx(Array.from({ length: n }, () => ({ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" })));
    }
    if (href === HELIUS && (method === "getBlockHeight" || method === "getSlot")) return rpc(1);
    if (href === HELIUS && method === "getAccountInfo") {
      const target = body?.params?.[0];
      if (target === delegate.address && delegated) {
        return rpcCtx({ data: ["", "base64"], executable: false, lamports: 1, owner: "11111111111111111111111111111111", rentEpoch: 0 });
      }
      return rpcCtx(null);
    }
    if (href === HELIUS && (method === "getMultipleAccounts" || method === "getMultipleAccountsInfo")) {
      const n = Array.isArray(body?.params?.[0]) ? body.params[0].length : 1;
      return rpcCtx(Array.from({ length: n }, () => null));
    }
    if (href === HELIUS && method === "getBalance") return rpcCtx(1_000_000_000);
    if (href === HELIUS && method === "getMinimumBalanceForRentExemption") return rpc(890880);
    if (href === HELIUS && method === "simulateTransaction") return rpcCtx({ err: null, logs: [], unitsConsumed: 1, accounts: null, returnData: null });
    if (href === HELIUS && (method === "getAsset" || method === "getAssetsByOwner" || method === "searchAssets")) {
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
    throw new Error(`${label} unexpected ${href} ${method}`);
  };
  const port = {
    fetchImpl,
    heliusRpcUrl: async () => HELIUS,
    revealLocalWalletSecret: async () => SECRET,
  };
  assert.equal("sendAgentTools" in port, false);
  const mint = await agent.executeSolanaAgentRoutedTool(port, "solana_agent_mint", {
    wallet_name: "ops", name: "My AI Agent", uri: "https://example.com/agent-metadata.json", description: "An autonomous trading agent",
  });
  const identity = await agent.executeSolanaAgentRoutedTool(port, "solana_agent_register_identity", {
    wallet_name: "ops", asset: ASSET, agent_registration_uri: "https://example.com/agent-registration.json",
  });
  const executive = await agent.executeSolanaAgentRoutedTool(port, "solana_agent_register_executive", { wallet_name: "ops" });
  const delegatedResult = await agent.executeSolanaAgentRoutedTool(port, "solana_agent_delegate_execution", { wallet_name: "ops", agent_asset: ASSET });
  delegated = true;
  const verifyOn = await agent.executeSolanaAgentRoutedTool(port, "solana_agent_verify_delegation", { agent_asset: ASSET, executive_authority: payer });
  const revoked = await agent.executeSolanaAgentRoutedTool(port, "solana_agent_revoke_execution", { wallet_name: "ops", agent_asset: ASSET, executive_authority: payer });
  delegated = false;
  const verifyOff = await agent.executeSolanaAgentRoutedTool(port, "solana_agent_verify_delegation", { agent_asset: ASSET, executive_authority: payer });
  const genesis = await agent.executeSolanaAgentRoutedTool(port, "solana_agent_launch_token", {
    wallet_name: "ops", agent_asset: ASSET, name: "AGT", symbol: "AGT", image: "https://gateway.irys.xyz/abc",
  });
  const das = serviceMod.createSolanaService({
    revealSecret: async () => null,
    readRegistry: async () => ({ schemaVersion: 1, wallets: [] }),
    writeRegistry: async () => {},
    loadServerSdk: async () => ({ ServerSDK: class {} }),
    envHeliusRpcUrl: HELIUS,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: JSON.parse(options.body).method, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        jsonrpc: "2.0", id: "1",
        result: { items: [{ id: ASSET, is_agent: true, asset_signer: "Signer1111111111111111111111111111111111" }], nativeBalance: { lamports: 1_000_000_000 }, is_agent: true },
      }), { status: 200 });
    },
  });
  const wallet = await das.getWalletAssets({ ownerAddress: ASSET });
  assert.equal(mint.rpcUrl, HELIUS);
  assert.ok(mint.assetAddress);
  assert.equal(mint.signature, SIG);
  assert.equal(identity.signature, SIG);
  assert.equal(executive.rpcUrl, HELIUS);
  assert.equal(delegatedResult.signature, SIG);
  assert.equal(verifyOn.delegated, true);
  assert.equal(revoked.signature, SIG);
  assert.equal(verifyOff.delegated, false);
  assert.ok(genesis.mintAddress);
  assert.ok(genesis.launch.link);
  assert.equal(wallet.items[0].is_agent, true);
  assert.ok(wallet.nativeBalance.lamports > 0);
  assert.ok(calls.some(c => String(c.url).includes("/v1/agents/mint")));
  assert.ok(calls.some(c => String(c.url).includes("/v1/launches/create")));
  assert.ok(calls.some(c => String(c.url).includes("/v1/launches/register")));
  assert.ok(calls.filter(c => c.body?.method === "sendTransaction").every(c => c.url === HELIUS));
  assert.equal(calls.some(c => String(c.url).includes("api.mainnet-beta.solana.com")), false);
  return {
    assetAddress: mint.assetAddress,
    signature: mint.signature,
    identitySignature: identity.signature,
    delegatedAfter: verifyOn.delegated,
    delegatedAfterRevoke: verifyOff.delegated,
    revokeSignature: revoked.signature,
    mintAddress: genesis.mintAddress,
    launchLink: genesis.launch.link,
    dasItems: wallet.items.length,
    nativeBalance: wallet.nativeBalance.lamports,
  };
}

const agentLoad = await load("source/node-agent-coordinator/solana-agent-tools.ts");
const signLoad = await load("source/electron-main/solana/solana-tx-sign.ts");
const serviceLoad = await load("source/electron-main/solana/solana-service.ts");
const pdasLoad = await load("source/shared/solana-agent-pdas.ts");
try {
  const first = await runOnce(agentLoad.module, signLoad.module, serviceLoad.module, pdasLoad.module, "run-1");
  const second = await runOnce(agentLoad.module, signLoad.module, serviceLoad.module, pdasLoad.module, "run-2");
  assert.equal(first.assetAddress, second.assetAddress);
  assert.equal(first.signature, second.signature);
  assert.equal(first.identitySignature, second.identitySignature);
  assert.equal(first.revokeSignature, second.revokeSignature);
  assert.equal(first.mintAddress, second.mintAddress);
  assert.equal(first.dasItems, second.dasItems);
  console.log(JSON.stringify({ ok: true, first, second }, null, 2));
} finally {
  await agentLoad.dispose();
  await signLoad.dispose();
  await serviceLoad.dispose();
  await pdasLoad.dispose();
}

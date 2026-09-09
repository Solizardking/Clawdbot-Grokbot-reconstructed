import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  createJupiterSwapService,
  describeOrderBlocker,
  partiallySignJupiterOrderTransaction,
  resolveMaxBuySol,
  SOL_MINT,
  type JupiterSwapClient,
} from "./jupiter-swap.ts";
import { isJupiterSwapRoutedTool } from "./jupiter-swap-tools.ts";
import {
  createLocalSolanaWalletStore,
  solanaKeypairFromSeed,
  SolanaWalletNameTakenError,
} from "./local-wallets.ts";
import {
  createPumpTapeStore,
  executePumpRoutedTool,
  isPumpRoutedTool,
  parsePumpMessage,
  pumpRelayHttpUrl,
  pumpRelayWsUrl,
} from "./pump-tape.ts";
import { executeSolanaRoutedTool, isSolanaRoutedTool } from "./solana-routed-tools.ts";
import { createSolanaService, isValidSolanaAddress, readWalletRegistry } from "./solana-service.ts";
import { SOLANA_FAMILY_TOOLS } from "./tools.ts";

const scratch: string[] = [];
it("uses hosted Tracker for SOL balances and Helius for indexed assets without local provider keys", async () => {
  const paths: string[] = [];
  const solana = createSolanaService({
    revealSecret: async () => null,
    readRegistry: async () => ({ wallets: [] }),
    writeRegistry: async () => {},
    loadServerSdk: async () => { throw new Error("unused"); },
    hostedAccess: () => ({ origin: "https://clawd.example", token: "user-access-token" }),
    fetchImpl: async (url, init) => {
      paths.push(String(url));
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toEqual({ "content-type": "application/json", authorization: "Bearer user-access-token" });
      return Response.json({result: String(url).endsWith("/solana/rpc") ? {value: 123} : {items: []}});
    },
  });
  expect(await solana.getBalanceLamports("11111111111111111111111111111111")).toBe(123);
  await solana.getWalletAssets({ownerAddress: "11111111111111111111111111111111"});
  expect(paths).toEqual(["https://clawd.example/solana/rpc", "https://clawd.example/helius/rpc"]);
  expect((await solana.getStatus()).heliusConfigured).toBe(true);
});
afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

function memoryCodec() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`sealed:${plain}`),
    decryptString: (buffer: Buffer) => String(buffer).replace(/^sealed:/, ""),
  };
}

describe("local solana wallet store", () => {
  it("seals secrets, derives ed25519 keypairs, lists public rows, and rejects duplicate names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omb-solana-"));
    scratch.push(dir);
    let seedCounter = 0;
    const store = createLocalSolanaWalletStore({
      safeStorage: memoryCodec(),
      storePath: join(dir, "wallets.json"),
      randomSeed: () => {
        seedCounter += 1;
        return Buffer.alloc(32, seedCounter);
      },
      now: () => new Date(0),
    });
    const created = await store.generateLocalWallet({ name: "Primary" });
    expect(created.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    await expect(store.generateLocalWallet({ name: "Primary" })).rejects.toBeInstanceOf(SolanaWalletNameTakenError);
    await expect(store.generateLocalWallet({ name: "   " })).rejects.toThrow(/needs a name/);
    expect((await store.listLocalWallets()).wallets).toEqual([
      { name: "Primary", address: created.address, createdAt: new Date(0).toISOString() },
    ]);
    const keypair = solanaKeypairFromSeed(Buffer.alloc(32, seedCounter));
    expect(await store.revealLocalWalletSecret({ name: "Primary" })).toBe(keypair.secretKeyBase58);
    expect(isValidSolanaAddress(keypair.address)).toBe(true);
    expect(keypair.secretKeyBase58.length > created.address.length).toBe(true);
    expect(() => solanaKeypairFromSeed(Buffer.alloc(31))).toThrow(/exactly 32 bytes/);
    expect((await store.listLocalWallets()).wallets[0]?.address).toBe(created.address);
    const listed = await store.listLocalWallets();
    expect(JSON.stringify(listed)).not.toMatch(/sealed:/);
    expect(JSON.stringify(listed)).not.toContain(keypair.secretKeyBase58);
  });
});

describe("solana routed tools", () => {
  it("exposes the eleven grok-bot Solana family tool names", () => {
    expect(SOLANA_FAMILY_TOOLS.map((tool) => tool.name)).toEqual([
      "solana_list_wallets",
      "solana_wallet_assets",
      "solana_asset_get",
      "solana_assets_search",
      "pump_recent_launches",
      "pump_search_launches",
      "pump_token_enrichment",
      "pump_relay_status",
      "jupiter_token_price",
      "jupiter_buy_quote",
      "jupiter_buy_token",
    ]);
  });

  it("guards names, rejects invalid addresses, and lists local plus phantom wallets", async () => {
    expect(isSolanaRoutedTool("solana_wallet_assets")).toBe(true);
    expect(isSolanaRoutedTool("computer_use")).toBe(false);
    const registry = readWalletRegistry({
      schemaVersion: 1,
      wallets: [
        { walletId: "w1", name: "Phantom One", solanaAddress: "9".repeat(44), addresses: [], createdAt: "t" },
        { walletId: "", name: "skipped" },
        { walletId: "w3", name: "Local", address: "7".repeat(44), createdAt: "t" },
      ],
    });
    expect(registry).toHaveLength(2);
    const port = {
      listWallets: async () => ({ wallets: [{ name: "Phantom One", solanaAddress: "9".repeat(44) }] }),
      listLocalWallets: async () => ({ wallets: [{ name: "Local", address: "7".repeat(44), createdAt: "t" }] }),
      getWalletAssets: async () => ({ total: 0, items: [] }),
      getAsset: async ({ id }: { id: string }) => ({ id }),
      searchAssets: async () => ({}),
    };
    const listed = await executeSolanaRoutedTool(port, "solana_list_wallets", {});
    expect(listed).toEqual({
      ok: true,
      count: 2,
      wallets: [
        { name: "Phantom One", address: "9".repeat(44) },
        { name: "Local", address: "7".repeat(44) },
      ],
    });
    await expect(executeSolanaRoutedTool(port, "solana_wallet_assets", { owner_address: "nope" })).rejects.toThrow(
      /valid owner_address/,
    );
    await expect(executeSolanaRoutedTool(port, "solana_asset_get", { asset_id: "$$$" })).rejects.toThrow(/valid asset_id/);
    await expect(executeSolanaRoutedTool(port, "solana_assets_search", { owner_address: "not-base58" })).rejects.toThrow(
      /valid owner_address/,
    );
    await expect(executeSolanaRoutedTool(port, "solana_unknown_tool", {})).rejects.toThrow(/Unknown Solana routed tool/);
    const assets = await executeSolanaRoutedTool(port, "solana_wallet_assets", { owner_address: "9".repeat(44), limit: 99 });
    expect(assets.ok).toBe(true);
    expect((assets as { assets: { items: unknown[] } }).assets.items).toEqual([]);
  });

  it("returns the empty list shape for an empty wallet port", async () => {
    const empty = {
      listWallets: async () => ({ wallets: [] }),
      listLocalWallets: async () => ({ wallets: [] }),
      getWalletAssets: async () => ({ items: [] }),
      getAsset: async () => ({}),
      searchAssets: async () => ({}),
    };
    await expect(executeSolanaRoutedTool(empty, "solana_list_wallets", {})).resolves.toEqual({
      ok: true,
      count: 0,
      wallets: [],
    });
  });
});

describe("pump tape", () => {
  it("parses relay messages and serves recent/search/enrichment/status from memory", async () => {
    expect(isPumpRoutedTool("pump_recent_launches")).toBe(true);
    expect(isPumpRoutedTool("solana_list_wallets")).toBe(false);
    const tape = createPumpTapeStore({ now: () => 1_000 });
    expect(parsePumpMessage("not json")).toBeNull();
    const status = parsePumpMessage(JSON.stringify({ type: "status", connected: true }));
    const launch1 = parsePumpMessage(JSON.stringify({ type: "token-launch", signature: "sig1", name: "Alpha", mint: "MINT1" }));
    const launch2 = parsePumpMessage(JSON.stringify({ type: "token-launch", signature: "sig2", symbol: "BETA", hasGithub: true }));
    const dup = parsePumpMessage(JSON.stringify({ type: "token-launch", signature: "sig1", name: "duplicate ignored" }));
    const enriched = parsePumpMessage(JSON.stringify({ type: "token-enriched", mint: "MINT1", priceUsd: 0.0042 }));
    if (status) tape.apply(status);
    if (launch1) tape.apply(launch1);
    if (launch2) tape.apply(launch2);
    if (dup) tape.apply(dup);
    if (enriched) tape.apply(enriched);
    const snapshot = tape.snapshot();
    expect(snapshot.connectedToRelay).toBe(true);
    expect(snapshot.bufferedLaunches).toBe(2);
    expect(snapshot.trackedEnrichments).toBe(1);
    const fetchImpl = async () =>
      new Response(JSON.stringify({ ok: true, clients: 3 }), { status: 200, headers: { "content-type": "application/json" } });
    const recent = await executePumpRoutedTool("pump_recent_launches", { limit: 10 }, { store: tape, fetchImpl });
    expect(recent).toMatchObject({ ok: true, count: 2 });
    const github = await executePumpRoutedTool("pump_recent_launches", { github_only: true }, { store: tape, fetchImpl });
    expect(github).toMatchObject({ ok: true, count: 1 });
    const search = await executePumpRoutedTool("pump_search_launches", { query: "alp" }, { store: tape, fetchImpl });
    expect(search).toMatchObject({ ok: true, count: 1, query: "alp" });
    const enrich = await executePumpRoutedTool("pump_token_enrichment", { mints: ["MINT1"] }, { store: tape, fetchImpl });
    expect(enrich).toMatchObject({ ok: true, requested: 1 });
    expect((enrich as { found: Record<string, unknown> }).found.MINT1).toMatchObject({ mint: "MINT1", priceUsd: 0.0042 });
    const relay = await executePumpRoutedTool("pump_relay_status", {}, { store: tape, fetchImpl, env: {} });
    expect(relay).toMatchObject({ ok: true, local: { connectedToRelay: true, bufferedLaunches: 2 } });
    expect(pumpRelayWsUrl({})).toBe("wss://clawd-ws.fly.dev/ws");
    expect(pumpRelayHttpUrl({ SAND_PUMP_HTTP_URL: "https://relay.example/" })).toBe("https://relay.example");
    await expect(executePumpRoutedTool("pump_search_launches", { query: "  " }, { store: tape })).rejects.toThrow(/non-empty query/);
    await expect(executePumpRoutedTool("pump_unknown", {}, { store: tape })).rejects.toThrow(/Unknown pump tape tool/);
  });
});

describe("jupiter swap tools", () => {
  it("resolves the per-trade cap, requires confirm, signs only local wallets, and returns a solscan link", async () => {
    expect(resolveMaxBuySol({})).toBe(0.25);
    expect(resolveMaxBuySol({ SAND_MAX_BUY_SOL: "0.1" })).toBe(0.1);
    expect(resolveMaxBuySol({ SAND_MAX_BUY_SOL: "999" })).toBe(10);
    expect(resolveMaxBuySol({ SAND_MAX_BUY_SOL: "0.0001" })).toBe(0.001);
    expect(isJupiterSwapRoutedTool("jupiter_buy_token")).toBe(true);
    expect(isJupiterSwapRoutedTool("solana_list_wallets")).toBe(false);

    const TARGET_MINT = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
    const payer = Keypair.generate();
    const wallets = {
      listLocalWallets: async () => ({
        wallets: [{ name: "Trading", address: payer.publicKey.toBase58(), createdAt: "t" }],
      }),
      revealLocalWalletSecret: async () => bs58.encode(payer.secretKey),
    };
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [],
    }).compileToV0Message();
    const orderTransaction = Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
    const calls: Array<{ kind: string; params: unknown }> = [];
    let orderResponse: Record<string, unknown> = {
      requestId: "req-1",
      transaction: orderTransaction,
      inAmount: "50000000",
      outAmount: "995000",
      outUsdValue: 7.4,
      router: "metis",
      mode: "ultra",
      feeBps: 10,
    };
    const client: JupiterSwapClient = {
      getOrder: async (params) => {
        calls.push({ kind: "order", params });
        return structuredClone(orderResponse) as never;
      },
      executeOrder: async (params) => {
        calls.push({ kind: "execute", params });
        return { status: "Success", signature: "SIG123", code: 0, totalInputAmount: "50000000", totalOutputAmount: "995000" };
      },
      getPrices: async () => ({ [SOL_MINT]: { usdPrice: 150, decimals: 9 } }),
    };
    const service = createJupiterSwapService({
      revealSecret: async () => "key",
      localWallets: wallets,
      env: { SAND_MAX_BUY_SOL: "0.1" },
      client,
    });

    expect(service.tools).toHaveLength(3);
    const priced = (await service.executeTool("jupiter_token_price", { mints: [SOL_MINT, "!!bad!!"] })) as {
      requested: number;
      accepted: number;
      found: number;
      rejected: string[];
      prices: Record<string, { usdPrice?: number }>;
    };
    expect([priced.requested, priced.accepted, priced.found]).toEqual([2, 1, 1]);
    expect(priced.rejected).toEqual(["!!bad!!"]);
    expect(priced.prices[SOL_MINT]?.usdPrice).toBe(150);

    const quote = (await service.executeTool("jupiter_buy_quote", {
      output_mint: "Mint11111111111111111111111111111111111111".slice(0, 44),
      sol_amount: 5,
    })) as { solIn: number; quoteOnly: boolean };
    expect(quote.solIn).toBe(0.1);
    expect(quote.quoteOnly).toBe(true);

    await expect(
      service.executeTool("jupiter_buy_token", { wallet_name: "Trading", output_mint: TARGET_MINT, sol_amount: 0.01 }),
    ).rejects.toThrow(/confirm:true/);
    await expect(
      service.executeTool("jupiter_buy_token", { wallet_name: "Trading", output_mint: TARGET_MINT, sol_amount: 5, confirm: true }),
    ).rejects.toThrow(/per-trade cap/);
    await expect(
      service.executeTool("jupiter_buy_token", { wallet_name: "Nope", output_mint: TARGET_MINT, sol_amount: 0.01, confirm: true }),
    ).rejects.toThrow(/No local wallet named/);

    const bought = (await service.executeTool("jupiter_buy_token", {
      wallet_name: "trading",
      output_mint: TARGET_MINT,
      sol_amount: 0.05,
      confirm: true,
    })) as { ok: boolean; signature: string; solscanUrl: string; spentSol: number };
    const executed = calls.find((call) => call.kind === "execute") as { params: { requestId: string; signedTransaction: string } };
    expect(executed.params.requestId).toBe("req-1");
    const signed = VersionedTransaction.deserialize(Buffer.from(executed.params.signedTransaction, "base64"));
    const recovered = signed.signatures[0];
    expect(nacl.sign.detached.verify(Buffer.from(signed.message.serialize()), recovered, payer.publicKey.toBytes())).toBe(true);
    expect(bought.ok).toBe(true);
    expect(bought.signature).toBe("SIG123");
    expect(bought.spentSol).toBe(0.05);
    expect(bought.solscanUrl).toBe("https://solscan.io/tx/SIG123");

    orderResponse = { ...orderResponse, transaction: "", router: "dflow", errorCode: 2 };
    await expect(
      service.executeTool("jupiter_buy_token", { wallet_name: "Trading", output_mint: TARGET_MINT, sol_amount: 0.05, confirm: true }),
    ).rejects.toThrow(/insufficient SOL for gas/);
    expect(describeOrderBlocker(orderResponse as never)).toMatch(/dflow.*insufficient SOL for gas/);

    client.executeOrder = async () => ({ status: "Failed", signature: "SIGBAD", code: -1000, error: "slipped" });
    orderResponse = { ...orderResponse, transaction: orderTransaction };
    await expect(
      service.executeTool("jupiter_buy_token", { wallet_name: "Trading", output_mint: TARGET_MINT, sol_amount: 0.05, confirm: true }),
    ).rejects.toThrow(/Jupiter swap failed \(code -1000\)/);

    expect(() => partiallySignJupiterOrderTransaction(orderTransaction, bs58.encode(Buffer.alloc(32)))).toThrow(/64 bytes/);
  });

  it("refuses a confirm:true buy when Helius getBalance value cannot fund the trade plus fees", async () => {
    const TARGET_MINT = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
    const payer = Keypair.generate();
    const heliusCalls: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: unknown };
      heliusCalls.push(payload);
      expect(payload.method).toBe("getBalance");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "clawdbot-solana", result: { context: { slot: 1 }, value: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const solana = createSolanaService({
      revealSecret: async (key) => (key === "HELIUS_API_KEY" ? "test-helius" : null),
      readRegistry: async () => ({ wallets: [] }),
      writeRegistry: async () => {},
      loadServerSdk: async () => {
        throw new Error("unused");
      },
      fetchImpl,
    });
    expect(await solana.getBalanceLamports(payer.publicKey.toBase58())).toBe(0);

    const executeCalls: unknown[] = [];
    const service = createJupiterSwapService({
      revealSecret: async () => "key",
      localWallets: {
        listLocalWallets: async () => ({
          wallets: [{ name: "Trading", address: payer.publicKey.toBase58(), createdAt: "t" }],
        }),
        revealLocalWalletSecret: async () => bs58.encode(payer.secretKey),
      },
      getSolBalanceLamports: (address) => solana.getBalanceLamports(address),
      env: { SAND_MAX_BUY_SOL: "0.25" },
      client: {
        getOrder: async () => {
          throw new Error("Jupiter /order must not run after an underfunded preflight");
        },
        executeOrder: async (params) => {
          executeCalls.push(params);
          return { status: "Success", signature: "SHOULD-NOT-SIGN", code: 0 };
        },
        getPrices: async () => ({}),
      },
    });

    await expect(
      service.executeTool("jupiter_buy_token", {
        wallet_name: "Trading",
        output_mint: TARGET_MINT,
        sol_amount: 0.05,
        confirm: true,
      }),
    ).rejects.toThrow(/not enough for a 0.05 SOL purchase plus fees/);
    expect(executeCalls).toEqual([]);
    expect(heliusCalls.some((call) => (call as { method?: string }).method === "getBalance")).toBe(true);
  });
});

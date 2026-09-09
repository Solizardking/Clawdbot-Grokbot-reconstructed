import bs58 from "bs58";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

import {
  isJupiterSwapRoutedTool,
  JUPITER_SWAP_ROUTED_TOOLS,
  parseJupiterSwapToolArgs,
  type JupiterSwapToolDefinition,
} from "./jupiter-swap-tools.ts";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const JUPITER_SECRET_KEY = "JUPITER_API_KEY";
export const JUPITER_SWAP_BASE_URL = "https://api.jup.ag/swap/v2";
export const JUPITER_PRICE_BASE_URL = "https://api.jup.ag/price/v3";
export const LAMPORTS_PER_SOL = 1_000_000_000;
/** Safety rail: largest single chat-initiated purchase unless overridden. */
export const DEFAULT_MAX_BUY_SOL = 0.25;
const BUY_BUFFER_LAMPORTS = 5_000_000;

type FetchLike = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function firstSecret(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function isValidMint(value: unknown): value is string {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

export function resolveMaxBuySol(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SAND_MAX_BUY_SOL?.trim() ?? env.OMB_MAX_BUY_SOL?.trim();
  if (raw == null || raw.length === 0) return DEFAULT_MAX_BUY_SOL;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_BUY_SOL;
  return Math.min(10, Math.max(0.001, parsed));
}

export function solToLamports(amount: number): bigint {
  return BigInt(Math.round(amount * LAMPORTS_PER_SOL));
}

export interface JupiterOrderResponse {
  transaction: string | null;
  requestId: string;
  inAmount?: string;
  outAmount?: string;
  inUsdValue?: number;
  outUsdValue?: number;
  priceImpact?: number;
  slippageBps?: number;
  router?: string;
  mode?: string;
  feeBps?: number;
  feeMint?: string;
  errorCode?: number;
  errorMessage?: string;
}

export interface JupiterExecuteResponse {
  status: "Success" | "Failed";
  signature: string;
  code: number;
  totalInputAmount?: string;
  totalOutputAmount?: string;
  inputAmountResult?: string;
  outputAmountResult?: string;
  error?: string;
}

export type JupiterPriceMap = Record<string, { usdPrice?: number; decimals?: number; liquidity?: number; priceChange24h?: number }>;

export class JupiterApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "JupiterApiError";
    this.status = status;
  }
}

export function describeOrderBlocker(order: JupiterOrderResponse): string {
  const router = order.router ?? "unknown-router";
  const code = order.errorCode;
  const meaning = (() => {
    if (code == null) return "";
    if (router === "jupiterz") {
      return code === 1 ? "insufficient balance to fund the swap" : code === 2 ? "missing associated token account" : "quote could not be built into a transaction";
    }
    return code === 1 ? "insufficient funds" : code === 2 ? "insufficient SOL for gas" : "swap below minimum for gasless";
  })();
  return [
    `Jupiter router "${router}" quoted a price but could not build a swap transaction.`,
    meaning.length > 0 ? `Reason (${code}): ${meaning}.` : "",
    order.errorMessage == null ? "" : `Detail: ${order.errorMessage}.`,
    `Quoted output was still ${order.outAmount ?? "?"}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface JupiterSwapClient {
  getOrder(params: { inputMint: string; outputMint: string; amount: string; taker?: string }): Promise<JupiterOrderResponse>;
  executeOrder(params: { signedTransaction: string; requestId: string }): Promise<JupiterExecuteResponse>;
  getPrices(mints: readonly string[]): Promise<JupiterPriceMap>;
}

export function createJupiterSwapClient(options: {
  apiKey: () => Promise<string | null>;
  baseUrl?: string;
  priceBaseUrl?: string;
  fetchImpl?: FetchLike | undefined;
}): JupiterSwapClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? JUPITER_SWAP_BASE_URL).replace(/\/+$/, "");
  const priceBaseUrl = (options.priceBaseUrl ?? JUPITER_PRICE_BASE_URL).replace(/\/+$/, "");
  const headers = async (): Promise<Record<string, string>> => {
    const apiKey = await options.apiKey();
    return { accept: "application/json", ...(apiKey == null ? {} : { "x-api-key": apiKey }) };
  };

  return {
    async getOrder(params) {
      const query = new URLSearchParams({ inputMint: params.inputMint, outputMint: params.outputMint, amount: params.amount });
      if (params.taker != null) query.set("taker", params.taker);
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/order?${query}`, { headers: await headers(), cache: "no-store" });
      } catch (error) {
        throw new Error(`Jupiter /order request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = isRecord(payload) && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
        throw new JupiterApiError(`Jupiter /order failed: ${detail}`, response.status);
      }
      if (!isRecord(payload) || typeof payload.requestId !== "string") throw new JupiterApiError("Jupiter /order returned a malformed response.", response.status);
      return payload as unknown as JupiterOrderResponse;
    },
    async executeOrder(params) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/execute`, {
          method: "POST",
          headers: { ...(await headers()), "content-type": "application/json" },
          body: JSON.stringify({ signedTransaction: params.signedTransaction, requestId: params.requestId }),
        });
      } catch (error) {
        throw new Error(`Jupiter /execute request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const payload = await response.json().catch(() => null);
      if (!isRecord(payload) || typeof payload.status !== "string") {
        const detail = isRecord(payload) && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
        throw new JupiterApiError(`Jupiter /execute failed: ${detail}`, response.status);
      }
      return payload as unknown as JupiterExecuteResponse;
    },
    async getPrices(mints) {
      const unique = [...new Set(mints.map((mint) => mint.trim()).filter(Boolean))].slice(0, 50);
      if (unique.length === 0) return {};
      let response: Response;
      try {
        response = await fetchImpl(`${priceBaseUrl}?ids=${encodeURIComponent(unique.join(","))}`, { headers: await headers(), cache: "no-store" });
      } catch (error) {
        throw new Error(`Jupiter price request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = isRecord(payload) && typeof payload.message === "string" ? payload.message : `HTTP ${response.status}`;
        throw new JupiterApiError(`Jupiter price request failed: ${detail}`, response.status);
      }
      if (!isRecord(payload)) return {};
      const prices: JupiterPriceMap = {};
      for (const [mint, entry] of Object.entries(payload)) {
        const row = record(entry);
        if (row == null) continue;
        const projected: JupiterPriceMap[string] = {};
        if (typeof row.usdPrice === "number") projected.usdPrice = row.usdPrice;
        if (typeof row.decimals === "number") projected.decimals = row.decimals;
        if (typeof row.liquidity === "number") projected.liquidity = row.liquidity;
        if (typeof row.priceChange24h === "number") projected.priceChange24h = row.priceChange24h;
        prices[mint] = projected;
      }
      return prices;
    },
  };
}

/**
 * Signs the taker portion of a Jupiter /order versioned transaction. Partial
 * signing keeps room for the JupiterZ market-maker counter-signature that
 * /execute appends.
 */
export function partiallySignJupiterOrderTransaction(orderTransactionBase64: string, secretKeyBase58: string): string {
  let secretBytes: Uint8Array;
  try {
    secretBytes = bs58.decode(secretKeyBase58.trim());
  } catch {
    throw new Error("The stored wallet secret is not valid base58.");
  }
  if (secretBytes.length !== 64) throw new Error(`A Solana spending secret must be 64 bytes; this one is ${secretBytes.length}.`);
  const keypair = Keypair.fromSecretKey(Buffer.from(secretBytes));
  const transaction = VersionedTransaction.deserialize(Buffer.from(orderTransactionBase64, "base64"));
  const messageBytes = Buffer.from(transaction.message.serialize());
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  transaction.addSignature(keypair.publicKey, signature);
  return Buffer.from(transaction.serialize()).toString("base64");
}

export interface LocalSpendingWalletPort {
  listLocalWallets(): Promise<{ wallets: readonly { name: string; address: string; createdAt: string }[] }>;
  revealLocalWalletSecret(raw: unknown): Promise<string>;
}

export interface JupiterSwapServiceDeps {
  revealSecret: (key: string) => Promise<unknown>;
  localWallets: LocalSpendingWalletPort;
  getSolBalanceLamports?: ((address: string) => Promise<number | null>) | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  client?: JupiterSwapClient | undefined;
  now?: (() => number) | undefined;
  signOrderTransaction?: ((orderTransactionBase64: string, secretKeyBase58: string) => string) | undefined;
}

export interface JupiterSwapService {
  readonly tools: readonly JupiterSwapToolDefinition[];
  executeTool(name: string, args: unknown): Promise<unknown>;
  isConfigured(): Promise<boolean>;
}

interface ResolvedWallet {
  name: string;
  address: string;
}

async function resolveLocalWallet(localWallets: LocalSpendingWalletPort, walletName: unknown): Promise<ResolvedWallet> {
  const requested = typeof walletName === "string" ? walletName.trim() : "";
  if (requested.length === 0) throw new Error("jupiter_buy_token requires wallet_name of a local app wallet.");
  const wallets = (await localWallets.listLocalWallets()).wallets;
  const match = wallets.find((wallet) => wallet.name.toLowerCase() === requested.toLowerCase()) ?? wallets.find((wallet) => wallet.name === requested);
  if (match == null) {
    const known = wallets.map((wallet) => wallet.name).join(", ");
    throw new Error(`No local wallet named "${requested}". Available wallets: ${known.length > 0 ? known : "(none)"}. Only local wallets can sign swaps.`);
  }
  return match;
}

export function createJupiterSwapService(deps: JupiterSwapServiceDeps): JupiterSwapService {
  const env = deps.env ?? process.env;
  const signOrder = deps.signOrderTransaction ?? partiallySignJupiterOrderTransaction;
  const apiKey = async (): Promise<string | null> => {
    const stored = firstSecret(await deps.revealSecret(JUPITER_SECRET_KEY));
    const direct = stored ?? firstSecret(env.JUPITER_API_KEY);
    if (direct != null) return direct;
    return null;
  };
  const client = deps.client ?? createJupiterSwapClient({ apiKey });

  const quote = async (outputMint: string, solAmount: number, taker?: string) => {
    const order = await client.getOrder({
      inputMint: SOL_MINT,
      outputMint,
      amount: solToLamports(solAmount).toString(),
      ...(taker == null ? {} : { taker }),
    });
    return order;
  };

  const buy = async (args: Record<string, unknown>) => {
    if (args.confirm !== true) throw new Error("jupiter_buy_token refused: pass confirm:true to acknowledge this spends real SOL.");
    const maxSol = resolveMaxBuySol(env);
    const wallet = await resolveLocalWallet(deps.localWallets, args.wallet_name);
    const mintRaw = args.output_mint;
    if (!isValidMint(mintRaw)) throw new Error("jupiter_buy_token requires a valid output_mint token address.");
    const outputMint = mintRaw.trim();
    if (outputMint === SOL_MINT) throw new Error("Buying SOL with SOL is a no-op; pick a different token.");
    const solAmount = typeof args.sol_amount === "number" && Number.isFinite(args.sol_amount) ? args.sol_amount : NaN;
    if (!(solAmount > 0)) throw new Error("jupiter_buy_token requires a positive sol_amount.");
    if (solAmount > maxSol) {
      throw new Error(`jupiter_buy_token refused: sol_amount ${solAmount} exceeds the per-trade cap of ${maxSol} SOL (override with SAND_MAX_BUY_SOL).`);
    }
    const lamports = solToLamports(solAmount);
    if (deps.getSolBalanceLamports != null) {
      const balance = await deps.getSolBalanceLamports(wallet.address);
      const needed = Number(lamports) + BUY_BUFFER_LAMPORTS;
      if (balance != null && balance < needed) {
        throw new Error(
          `Wallet "${wallet.name}" has ${(Number(balance) / LAMPORTS_PER_SOL).toFixed(4)} SOL, which is not enough for a ${solAmount} SOL purchase plus fees.`,
        );
      }
    }
    const order = await client.getOrder({ inputMint: SOL_MINT, outputMint, amount: lamports.toString(), taker: wallet.address });
    if (order.transaction == null || order.transaction.length === 0) throw new Error(describeOrderBlocker(order));
    const signedTransaction = signOrder(order.transaction, await deps.localWallets.revealLocalWalletSecret({ name: wallet.name }));
    const result = await client.executeOrder({ signedTransaction, requestId: order.requestId });
    if (result.status !== "Success") {
      const detail = result.error == null ? "" : ` Detail: ${result.error}`;
      throw new Error(`Jupiter swap failed (code ${result.code})${result.signature == null ? "" : `, signature ${result.signature}`}${detail}`);
    }
    const spentLamports = result.totalInputAmount == null ? null : Number(result.totalInputAmount);
    return {
      ok: true,
      status: result.status,
      wallet: wallet.name,
      walletAddress: wallet.address,
      boughtMint: outputMint,
      spentSol: spentLamports == null ? null : spentLamports / LAMPORTS_PER_SOL,
      tokensReceivedRaw: result.totalOutputAmount ?? null,
      expectedTokensRaw: order.outAmount ?? null,
      usdValue: order.outUsdValue ?? null,
      router: order.router ?? null,
      feeBps: order.feeBps ?? null,
      signature: result.signature,
      solscanUrl: `https://solscan.io/tx/${result.signature}`,
    };
  };

  return {
    tools: JUPITER_SWAP_ROUTED_TOOLS,
    async isConfigured() {
      try {
        await apiKey();
        return true;
      } catch {
        return false;
      }
    },
    async executeTool(name, rawArgs) {
      if (!isJupiterSwapRoutedTool(name)) throw new Error(`Unknown Jupiter swap tool: ${name}`);
      const args = parseJupiterSwapToolArgs(rawArgs);
      switch (name) {
        case "jupiter_token_price": {
          const raw = Array.isArray(args.mints) ? args.mints : [];
          const rejected = raw.filter((mint) => !isValidMint(mint));
          const mints = raw.filter((mint): mint is string => isValidMint(mint));
          if (mints.length === 0) throw new Error("jupiter_token_price requires at least one valid mint address.");
          const prices = await client.getPrices(mints);
          const found = Object.keys(prices);
          return {
            ok: true,
            requested: raw.length,
            accepted: mints.length,
            ...(rejected.length > 0 ? { rejected } : {}),
            found: found.length,
            missing: mints.filter((mint) => !found.includes(mint)),
            prices,
          };
        }
        case "jupiter_buy_quote": {
          if (!isValidMint(args.output_mint)) throw new Error("jupiter_buy_quote requires a valid output_mint token address.");
          const solAmount = typeof args.sol_amount === "number" && Number.isFinite(args.sol_amount) ? args.sol_amount : NaN;
          if (!(solAmount > 0)) throw new Error("jupiter_buy_quote requires a positive sol_amount.");
          const capped = Math.min(solAmount, resolveMaxBuySol(env));
          const order = await quote(args.output_mint.trim(), capped);
          return {
            ok: true,
            quoteOnly: true,
            inputMint: SOL_MINT,
            outputMint: args.output_mint.trim(),
            solIn: capped,
            expectedTokensRaw: order.outAmount ?? null,
            usdValue: order.outUsdValue ?? null,
            priceImpactPct: order.priceImpact ?? null,
            router: order.router ?? null,
            feeBps: order.feeBps ?? null,
            note: order.outAmount == null ? "Jupiter returned no quote for this pair." : undefined,
          };
        }
        case "jupiter_buy_token":
          return await buy(args);
        default:
          throw new Error(`Unknown Jupiter swap tool: ${name}`);
      }
    },
  };
}

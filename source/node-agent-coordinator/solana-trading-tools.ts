import { readFileSync } from "node:fs";

import { isValidSolanaAddress } from "../electron-main/solana/solana-service.js";
import { keypairFromSecret, signVersionedTransaction } from "../electron-main/solana/solana-tx-sign.js";
import { HELIUS_API_KEY_ENV, HELIUS_RPC_URL_KEY, JUPITER_API_KEY_ENV, deriveHeliusRpcUrl, resolveSolanaBotEnv } from "../shared/solana-bot-env.js";
import { getBoxSecretsStorePath } from "../host/extensions/secrets/secrets-service.js";

/**
 * Solana trading surfaces exposed to routed inference. Read data flows
 * through the Helius JSON-RPC (read-only method allowlist); transactions are
 * submitted via Helius sendTransaction; swaps are quoted through Jupiter and
 * signed server-side with an app-local wallet so private key material never
 * reaches the model.
 */
export interface SolanaTradingPort {
  readonly fetchImpl: typeof fetch;
  /** Resolves the full JSON-RPC endpoint (including auth) on each call. */
  readonly heliusRpcUrl: () => Promise<string>;
  readonly jupiterApiKey: () => Promise<string | null>;
  /** Absent on hosted surfaces: swaps then fail with a clean error. */
  readonly revealLocalWalletSecret?: (raw: unknown) => Promise<string>;
}

export interface SolanaTradingTool {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const PROVIDER = "grok-bot-local-solana-trading";

/** Read-only JSON-RPC methods the model may call; mutations get dedicated tools. */
export const HELIUS_READ_METHODS: readonly string[] = [
  "getBalance", "getAccountInfo", "getMultipleAccounts", "getProgramAccounts",
  "getTokenAccountsByOwner", "getTokenAccountsByDelegate", "getTokenSupply",
  "getTokenLargestAccounts", "getSignaturesForAddress", "getTransaction",
  "getLatestBlockhash", "isBlockhashValid", "getBlockHeight", "getEpochInfo",
  "getMinimumBalanceForRentExemption", "getFeeForMessage", "getVersion", "getHealth",
];

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

const MINT_FIELD = { type: "string", description: "A base58 Solana mint address (32-44 characters)." } as const;

const RPC_CALL_SCHEMA = {
  type: "object",
  properties: {
    method: { type: "string", enum: [...HELIUS_READ_METHODS], description: "Solana JSON-RPC read method." },
    params: { type: "array", description: "JSON-RPC positional parameters for the method." },
  },
  required: ["method"],
  additionalProperties: false,
} as const;

const SEND_TRANSACTION_SCHEMA = {
  type: "object",
  properties: {
    transaction: { type: "string", description: "Fully signed Solana transaction, base64-encoded (versioned wire format)." },
    skip_preflight: { type: "boolean", default: false, description: "Skip simulation before sending." },
  },
  required: ["transaction"],
  additionalProperties: false,
} as const;

const JUPITER_QUOTE_SCHEMA = {
  type: "object",
  properties: {
    input_mint: MINT_FIELD,
    output_mint: MINT_FIELD,
    amount: { type: "string", description: "Input amount in raw base units (u64 as string, e.g. lamports for SOL)." },
    slippage_bps: { type: "integer", minimum: 0, maximum: 5000, default: 50 },
    only_direct_routes: { type: "boolean", default: false },
  },
  required: ["input_mint", "output_mint", "amount"],
  additionalProperties: false,
} as const;

const JUPITER_SWAP_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", description: "Name of an app-local Solana wallet (see solana_list_wallets) that signs and pays for the swap." },
    input_mint: MINT_FIELD,
    output_mint: MINT_FIELD,
    amount: { type: "string", description: "Input amount in raw base units (u64 as string, e.g. lamports for SOL)." },
    slippage_bps: { type: "integer", minimum: 0, maximum: 5000, default: 50 },
    destination_address: { type: "string", description: "Optional destination token account owner; defaults to the swapping wallet." },
  },
  required: ["wallet_name", "input_mint", "output_mint", "amount"],
  additionalProperties: false,
} as const;

const BUY_TOKEN_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", description: "Funded app-local wallet that pays SOL and receives the token." },
    mint: MINT_FIELD,
    sol: { type: "number", description: "SOL to spend, decimal (e.g. 0.05). Converted to lamports." },
    lamports: { type: "string", description: "Alternative to sol: raw lamports as a u64 string." },
    slippage_bps: { type: "integer", minimum: 0, maximum: 5000, default: 100 },
  },
  required: ["wallet_name", "mint"],
  additionalProperties: false,
} as const;

export const SOLANA_TRADING_ROUTED_TOOLS: readonly SolanaTradingTool[] = [
  {
    name: "solana_rpc_call",
    toolName: "solana_rpc_call",
    providerIdentifier: PROVIDER,
    description: "Call a read-only Solana JSON-RPC method (balances, token accounts, signatures, transactions, blockhash, epoch) through the configured Helius RPC endpoint. Use for live on-chain data.",
    inputSchema: RPC_CALL_SCHEMA,
  },
  {
    name: "solana_send_transaction",
    toolName: "solana_send_transaction",
    providerIdentifier: PROVIDER,
    description: "Submit an already-signed base64 Solana transaction to the network through Helius and return the signature. Only use for transactions you assembled and signed via other means.",
    inputSchema: SEND_TRANSACTION_SCHEMA,
  },
  {
    name: "jupiter_quote",
    toolName: "jupiter_quote",
    providerIdentifier: PROVIDER,
    description: "Get a Jupiter swap quote (expected out amount, price impact, route) for a Solana token pair. Amounts are raw base units. Read-only.",
    inputSchema: JUPITER_QUOTE_SCHEMA,
  },
  {
    name: "jupiter_swap",
    toolName: "jupiter_swap",
    providerIdentifier: PROVIDER,
    description: "Execute a Solana token swap through Jupiter: quote, build, sign with an app-local wallet, and submit. Moves real funds — confirm amounts and mints with the user first.",
    inputSchema: JUPITER_SWAP_SCHEMA,
  },
  {
    name: "solana_buy_token",
    toolName: "solana_buy_token",
    providerIdentifier: PROVIDER,
    description: "Buy a Solana token (including a live pump.fun mint) by spending SOL from a funded app-local wallet via Jupiter. Confirm the mint, SOL size, and wallet name with the user first. Use for one-shot buys or automated entries after quoting.",
    inputSchema: BUY_TOKEN_SCHEMA,
  },
];

export function isSolanaTradingRoutedTool(name: unknown): boolean {
  return typeof name === "string" && SOLANA_TRADING_ROUTED_TOOLS.some(tool => tool.name === name);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requireMint(value: unknown, field: string): string {
  if (!isValidSolanaAddress(value)) throw new Error(`${field} must be a valid base58 Solana address.`);
  return value;
}

function requireAmount(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value.trim())) {
    throw new Error("amount must be a raw base-unit integer as a string (u64), e.g. \"1000000000\".");
  }
  return value.trim();
}

function slippageBps(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5000 ? value : 50;
}

export function resolveJupiterBase(apiKey: string | null): string {
  return apiKey == null ? "https://lite-api.jup.ag" : "https://api.jup.ag";
}

export async function resolveTradingHeliusRpcUrl(port: Pick<SolanaTradingPort, "heliusRpcUrl">): Promise<string> {
  return await port.heliusRpcUrl();
}

async function jupiterFetch(port: SolanaTradingPort, path: string, init?: { method?: string; body?: string }): Promise<unknown> {
  const apiKey = await port.jupiterApiKey();
  const base = resolveJupiterBase(apiKey);
  const response = await port.fetchImpl(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(apiKey == null ? {} : { "x-api-key": apiKey }),
      ...(init?.body == null ? {} : { "content-type": "application/json" }),
    },
    ...(init?.body == null ? {} : { body: init.body }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = record(payload);
    const detail = error != null && typeof error.error === "string" ? error.error : `HTTP ${response.status}`;
    throw new Error(`Jupiter ${path.split("?")[0]} failed: ${detail}`);
  }
  return payload;
}

function requireSwapPort(port: SolanaTradingPort): { revealLocalWalletSecret: (raw: unknown) => Promise<string> } {
  if (port.revealLocalWalletSecret == null) {
    throw new Error("Signing wallets are only available in the desktop app; the hosted bridge cannot execute swaps.");
  }
  return { revealLocalWalletSecret: port.revealLocalWalletSecret };
}

async function heliusSend(port: SolanaTradingPort, transactionBase64: string, skipPreflight: boolean): Promise<string> {
  const url = await port.heliusRpcUrl();
  const response = await port.fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "sand-solana-trading",
      method: "sendTransaction",
      params: [transactionBase64, { encoding: "base64", skipPreflight, preflightCommitment: "confirmed", maxRetries: 3 }],
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  const root = record(payload);
  if (!response.ok || root == null || root.error != null) {
    const error = record(root?.error);
    const detail = error != null && typeof error.message === "string" ? error.message : `HTTP ${response.status}`;
    throw new Error(`sendTransaction failed: ${detail}`);
  }
  if (typeof root.result !== "string" || root.result.length < 32) throw new Error("sendTransaction returned no signature.");
  return root.result;
}

export async function executeSolanaTradingRoutedTool(port: SolanaTradingPort, name: string, args: unknown): Promise<unknown> {
  const request = record(args) ?? {};
  switch (name) {
    case "solana_rpc_call": {
      const method = typeof request.method === "string" ? request.method : "";
      if (!HELIUS_READ_METHODS.includes(method)) throw new Error(`solana_rpc_call only allows read methods (${HELIUS_READ_METHODS.length} supported); use solana_send_transaction to submit transactions.`);
      const params = Array.isArray(request.params) ? request.params : [];
      const url = await port.heliusRpcUrl();
      const response = await port.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "sand-solana-trading", method, params }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const root = record(payload);
      if (!response.ok || root == null || root.error != null) {
        const error = record(root?.error);
        const detail = error != null && typeof error.message === "string" ? error.message : `HTTP ${response.status}`;
        throw new Error(`Solana RPC ${method} failed: ${detail}`);
      }
      return { ok: true, method, result: root.result };
    }
    case "solana_send_transaction": {
      const transaction = typeof request.transaction === "string" ? request.transaction.trim() : "";
      if (transaction.length < 100) throw new Error("solana_send_transaction requires a base64-encoded signed Solana transaction.");
      const signature = await heliusSend(port, transaction, request.skip_preflight === true);
      return { ok: true, signature, explorer: `https://solscan.io/tx/${signature}`, note: "Submitted to mainnet; poll solana_rpc_call getSignatureStatuses via getTransaction for confirmation." };
    }
    case "jupiter_quote": {
      const inputMint = requireMint(request.input_mint, "input_mint");
      const outputMint = requireMint(request.output_mint, "output_mint");
      const amount = requireAmount(request.amount);
      const query = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slippageBps(request.slippage_bps)) });
      if (request.only_direct_routes === true) query.set("onlyDirectRoutes", "true");
      const quote = await jupiterFetch(port, `/swap/v1/quote?${query.toString()}`);
      const root = record(quote);
      if (root == null || typeof root.outAmount !== "string") throw new Error("Jupiter returned no usable quote.");
      return {
        ok: true,
        inputMint, outputMint, amount,
        outAmount: root.outAmount,
        slippageBps: slippageBps(request.slippage_bps),
        priceImpactPct: root.priceImpactPct ?? null,
        routeLabels: Array.isArray(root.routePlan) ? root.routePlan.map(step => record(record(step)?.swapInfo)?.label ?? null).filter(Boolean) : [],
        raw: root,
      };
    }
    case "jupiter_swap": {
      const { revealLocalWalletSecret } = requireSwapPort(port);
      const walletName = typeof request.wallet_name === "string" ? request.wallet_name.trim() : "";
      if (walletName.length === 0) throw new Error("jupiter_swap requires wallet_name of an app-local Solana wallet.");
      const inputMint = requireMint(request.input_mint, "input_mint");
      const outputMint = requireMint(request.output_mint, "output_mint");
      const amount = requireAmount(request.amount);
      const slippage = slippageBps(request.slippage_bps);
      const query = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slippage) });
      const quote = record(await jupiterFetch(port, `/swap/v1/quote?${query.toString()}`));
      if (quote == null || typeof quote.outAmount !== "string") throw new Error("Jupiter returned no usable quote for this swap.");
      const secretKeyBase58 = await revealLocalWalletSecret({ name: walletName });
      const payer = keypairFromSecret(secretKeyBase58).publicKey;
      const swapRequestBody: Record<string, unknown> = {
        quoteResponse: quote,
        userPublicKey: request.destination_address != null ? requireMint(request.destination_address, "destination_address") : payer,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      };
      const swap = record(await jupiterFetch(port, "/swap/v1/swap", { method: "POST", body: JSON.stringify(swapRequestBody) }));
      const unsigned = typeof swap?.swapTransaction === "string" ? swap.swapTransaction : null;
      if (unsigned == null) throw new Error("Jupiter returned no swap transaction.");
      const { signedTransaction, signer } = signVersionedTransaction(unsigned, secretKeyBase58);
      const signature = await heliusSend(port, signedTransaction, false);
      return {
        ok: true,
        wallet: signer,
        signature,
        explorer: `https://solscan.io/tx/${signature}`,
        inAmount: quote.inAmount ?? amount,
        outAmount: quote.outAmount,
        inputMint, outputMint, slippageBps: slippage,
        note: "Swap submitted to mainnet; confirm via solana_rpc_call getTransaction.",
      };
    }
    default:
      throw new Error(`Unknown Solana trading tool: ${name}`);
  }
}

/** Builds the Helius/Jupiter resolvers from process env + the secret store. */
export function createSolanaTradingEnvResolvers(options: {
  readonly revealSecret?: (key: string) => Promise<string | null>;
  readonly env?: NodeJS.ProcessEnv;
}): Pick<SolanaTradingPort, "heliusRpcUrl" | "jupiterApiKey"> {
  const env = options.env ?? process.env;
  return {
    heliusRpcUrl: async (): Promise<string> => {
      const resolved = await resolveSolanaBotEnv({ env, ...(options.revealSecret == null ? {} : { revealSecret: options.revealSecret }) });
      const explicit = resolved[HELIUS_RPC_URL_KEY];
      if (explicit != null) return explicit;
      const key = resolved[HELIUS_API_KEY_ENV];
      if (key != null) return deriveHeliusRpcUrl(key);
      throw new Error("Helius is not configured. Set HELIUS_RPC_URL or HELIUS_API_KEY (env or Settings → Solana panel).");
    },
    jupiterApiKey: async (): Promise<string | null> => {
      const resolved = await resolveSolanaBotEnv({ env, ...(options.revealSecret == null ? {} : { revealSecret: options.revealSecret }) });
      return resolved[JUPITER_API_KEY_ENV] ?? null;
    },
  };
}

/** Reads a key from the app's on-disk box secrets store (same store the router panel uses). */
export function boxSecretsReveal(key: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(getBoxSecretsStorePath(), "utf8")) as { secrets?: Record<string, unknown> };
    const stored = parsed.secrets?.[key];
    return typeof stored === "string" && stored.trim().length > 0 ? stored.trim() : null;
  } catch {
    return null;
  }
}

export function heliusTradingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicitRpc = typeof env[HELIUS_RPC_URL_KEY] === "string" && env[HELIUS_RPC_URL_KEY]!.trim().length > 0;
  const envKey = typeof env[HELIUS_API_KEY_ENV] === "string" && env[HELIUS_API_KEY_ENV]!.trim().length > 0;
  return explicitRpc || envKey || boxSecretsReveal(HELIUS_RPC_URL_KEY) != null || boxSecretsReveal(HELIUS_API_KEY_ENV) != null;
}

/** Tools appear only when a Helius endpoint can be resolved. */
export function solanaTradingRoutedTools(env: NodeJS.ProcessEnv = process.env): readonly SolanaTradingTool[] {
  return heliusTradingConfigured(env) ? SOLANA_TRADING_ROUTED_TOOLS : [];
}

/** Default port: global fetch + env/box-secrets resolvers. */
export function createDefaultSolanaTradingPort(options: {
  readonly revealLocalWalletSecret?: (raw: unknown) => Promise<string>;
} = {}): SolanaTradingPort {
  return {
    fetchImpl: globalThis.fetch as typeof fetch,
    ...createSolanaTradingEnvResolvers({ revealSecret: async key => boxSecretsReveal(key) }),
    ...(options.revealLocalWalletSecret == null ? {} : { revealLocalWalletSecret: options.revealLocalWalletSecret }),
  };
}

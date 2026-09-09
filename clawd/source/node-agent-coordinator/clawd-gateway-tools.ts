import { isValidSolanaAddress } from "../electron-main/solana/solana-service.js";
import { boxSecretsReveal, createSolanaTradingEnvResolvers } from "./solana-trading-tools.js";

/**
 * HTTP client for a running Clawd Gateway (default http://127.0.0.1:15888).
 * Quotes and Solana reads go through the gateway; HELIUS_RPC_URL is reported
 * so operators can point the gateway's Solana nodeURL at the same Helius
 * endpoint the rest of the app uses.
 */
export const CLAWD_GATEWAY_URL_KEY = "CLAWD_GATEWAY_URL";
export const CLAWD_GATEWAY_TOKEN_KEY = "CLAWD_GATEWAY_TOKEN";
export const DEFAULT_CLAWD_GATEWAY_URL = "http://127.0.0.1:15888";

export interface ClawdGatewayPort {
  readonly fetchImpl: typeof fetch;
  readonly gatewayUrl: () => Promise<string>;
  readonly gatewayToken: () => Promise<string | null>;
  readonly heliusRpcUrl: () => Promise<string>;
}

export interface ClawdGatewayTool {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const PROVIDER = "grok-bot-local-clawd-gateway";

const STATUS_SCHEMA = {
  type: "object",
  properties: { network: { type: "string", enum: ["mainnet-beta", "devnet"], default: "mainnet-beta" } },
  additionalProperties: false,
} as const;

const BALANCES_SCHEMA = {
  type: "object",
  properties: {
    address: { type: "string", description: "Solana wallet address." },
    network: { type: "string", enum: ["mainnet-beta", "devnet"], default: "mainnet-beta" },
    tokens: { type: "array", items: { type: "string" }, description: "Optional token symbols from the gateway token list (SOL, USDC, …)." },
  },
  required: ["address"],
  additionalProperties: false,
} as const;

const QUOTE_SCHEMA = {
  type: "object",
  properties: {
    base_token: { type: "string", default: "SOL" },
    quote_token: { type: "string", default: "USDC" },
    amount: { type: "number" },
    side: { type: "string", enum: ["BUY", "SELL"], default: "SELL" },
    connector: { type: "string", default: "jupiter/router" },
    chain_network: { type: "string", default: "solana-mainnet-beta" },
    slippage_pct: { type: "number", default: 1 },
  },
  required: ["amount"],
  additionalProperties: false,
} as const;

export const CLAWD_GATEWAY_ROUTED_TOOLS: readonly ClawdGatewayTool[] = [
  {
    name: "clawd_gateway_status",
    toolName: "clawd_gateway_status",
    providerIdentifier: PROVIDER,
    description: "Probe a running Clawd Gateway Solana endpoint (chain, network, current slot, swap provider) and report the HELIUS_RPC_URL this app would use for the same cluster.",
    inputSchema: STATUS_SCHEMA,
  },
  {
    name: "clawd_gateway_solana_balances",
    toolName: "clawd_gateway_solana_balances",
    providerIdentifier: PROVIDER,
    description: "Read token balances for a Solana address through Clawd Gateway POST /chains/solana/balances.",
    inputSchema: BALANCES_SCHEMA,
  },
  {
    name: "clawd_gateway_quote",
    toolName: "clawd_gateway_quote",
    providerIdentifier: PROVIDER,
    description: "Get a unified Clawd Gateway swap quote (default Jupiter on solana-mainnet-beta). Read-only; does not submit a swap.",
    inputSchema: QUOTE_SCHEMA,
  },
];

export function isClawdGatewayRoutedTool(name: unknown): boolean {
  return typeof name === "string" && CLAWD_GATEWAY_ROUTED_TOOLS.some(tool => tool.name === name);
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function clawdGatewayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return nonEmpty(env[CLAWD_GATEWAY_URL_KEY]) != null || boxSecretsReveal(CLAWD_GATEWAY_URL_KEY) != null;
}

export function clawdGatewayRoutedTools(env: NodeJS.ProcessEnv = process.env): readonly ClawdGatewayTool[] {
  return clawdGatewayConfigured(env) ? CLAWD_GATEWAY_ROUTED_TOOLS : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function gatewayFetch(port: ClawdGatewayPort, method: string, path: string, body?: unknown): Promise<unknown> {
  const base = (await port.gatewayUrl()).replace(/\/+$/, "");
  const token = await port.gatewayToken();
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token != null) headers.authorization = `Bearer ${token}`;
  try {
    headers["x-helius-rpc-url"] = await port.heliusRpcUrl();
  } catch {}
  const response = await port.fetchImpl(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = record(payload);
    const detail = error != null && typeof error.message === "string" ? error.message : `HTTP ${response.status}`;
    throw new Error(`Clawd Gateway ${method} ${path} failed: ${detail}`);
  }
  return payload;
}

export async function executeClawdGatewayRoutedTool(port: ClawdGatewayPort, name: string, args: unknown): Promise<unknown> {
  const request = record(args) ?? {};
  switch (name) {
    case "clawd_gateway_status": {
      const network = request.network === "devnet" ? "devnet" : "mainnet-beta";
      const status = await gatewayFetch(port, "GET", `/chains/solana/status?network=${encodeURIComponent(network)}`);
      let heliusRpcUrl: string | null = null;
      try { heliusRpcUrl = await port.heliusRpcUrl(); } catch { heliusRpcUrl = null; }
      return { ok: true, gateway: await port.gatewayUrl(), heliusRpcUrl, status };
    }
    case "clawd_gateway_solana_balances": {
      const address = request.address;
      if (!isValidSolanaAddress(address)) throw new Error("address must be a valid base58 Solana address.");
      const network = request.network === "devnet" ? "devnet" : "mainnet-beta";
      const tokens = Array.isArray(request.tokens) ? request.tokens.filter((item): item is string => typeof item === "string") : undefined;
      const result = await gatewayFetch(port, "POST", "/chains/solana/balances", {
        network,
        address,
        ...(tokens == null ? {} : { tokens }),
      });
      return { ok: true, address, network, result };
    }
    case "clawd_gateway_quote": {
      if (typeof request.amount !== "number" || !Number.isFinite(request.amount) || request.amount <= 0) {
        throw new Error("amount must be a positive number.");
      }
      const result = await gatewayFetch(port, "POST", "/trading/swap/quote", {
        chainNetwork: typeof request.chain_network === "string" ? request.chain_network : "solana-mainnet-beta",
        connector: typeof request.connector === "string" ? request.connector : "jupiter/router",
        baseToken: typeof request.base_token === "string" ? request.base_token : "SOL",
        quoteToken: typeof request.quote_token === "string" ? request.quote_token : "USDC",
        amount: request.amount,
        side: request.side === "BUY" ? "BUY" : "SELL",
        slippagePct: typeof request.slippage_pct === "number" ? request.slippage_pct : 1,
      });
      return { ok: true, result };
    }
    default:
      throw new Error(`Unknown Clawd Gateway tool: ${name}`);
  }
}

export function createDefaultClawdGatewayPort(options: {
  readonly fetchImpl?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
} = {}): ClawdGatewayPort {
  const env = options.env ?? process.env;
  const trading = createSolanaTradingEnvResolvers({ env, revealSecret: async key => boxSecretsReveal(key) });
  return {
    fetchImpl: options.fetchImpl ?? (globalThis.fetch as typeof fetch),
    gatewayUrl: async () => nonEmpty(env[CLAWD_GATEWAY_URL_KEY]) ?? boxSecretsReveal(CLAWD_GATEWAY_URL_KEY) ?? DEFAULT_CLAWD_GATEWAY_URL,
    gatewayToken: async () => nonEmpty(env[CLAWD_GATEWAY_TOKEN_KEY]) ?? boxSecretsReveal(CLAWD_GATEWAY_TOKEN_KEY),
    heliusRpcUrl: trading.heliusRpcUrl,
  };
}

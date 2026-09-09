import { isValidSolanaAddress } from "../electron-main/solana/solana-service.js";
import { resolveHostedProviderConfig } from "../shared/hosted-provider.js";
import { boxSecretsReveal } from "./solana-trading-tools.js";

export const BIRDEYE_API_KEY_ENV = "BIRDEYE_API_KEY";
export const BIRDEYE_API_BASE = "https://public-api.birdeye.so";
const PROVIDER = "grok-bot-local-birdeye";

export interface BirdeyePort {
  readonly fetchImpl: typeof fetch;
  readonly apiKey: () => Promise<string | null>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function birdeyeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const fromEnv = typeof env[BIRDEYE_API_KEY_ENV] === "string" && env[BIRDEYE_API_KEY_ENV]!.trim().length > 0;
  return fromEnv || boxSecretsReveal(BIRDEYE_API_KEY_ENV) != null;
}

const PRICE_SCHEMA = {
  type: "object",
  properties: {
    mints: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10, description: "Solana mint addresses to price on Birdeye." },
  },
  required: ["mints"],
  additionalProperties: false,
} as const;

const OVERVIEW_SCHEMA = {
  type: "object",
  properties: {
    mint: { type: "string", description: "Solana mint address." },
  },
  required: ["mint"],
  additionalProperties: false,
} as const;

export const BIRDEYE_ROUTED_TOOLS = [
  {
    name: "birdeye_token_price",
    toolName: "birdeye_token_price",
    providerIdentifier: PROVIDER,
    description: "Live Birdeye USD price, 24h change, and last update for up to 10 Solana mints. Use when talking about current pump.fun or SPL token prices. Uses connected hosted access or a personal Birdeye key.",
    inputSchema: PRICE_SCHEMA,
  },
  {
    name: "birdeye_token_overview",
    toolName: "birdeye_token_overview",
    providerIdentifier: PROVIDER,
    description: "Birdeye market overview for one Solana mint: price, market cap, liquidity, holders, 24h volume. Use before buying or summarizing a token. Uses connected hosted access or a personal Birdeye key.",
    inputSchema: OVERVIEW_SCHEMA,
  },
] as const;

export function isBirdeyeRoutedTool(name: unknown): boolean {
  return typeof name === "string" && BIRDEYE_ROUTED_TOOLS.some(tool => tool.name === name);
}

export function birdeyeRoutedTools(env: NodeJS.ProcessEnv = process.env): readonly typeof BIRDEYE_ROUTED_TOOLS[number][] {
  return birdeyeConfigured(env) ? [...BIRDEYE_ROUTED_TOOLS] : [...BIRDEYE_ROUTED_TOOLS];
}

async function requireKey(port: BirdeyePort): Promise<string> {
  const key = (await port.apiKey())?.trim() ?? "";
  if (key.length === 0) throw new Error("Birdeye is not configured. Connect hosted access or save a personal BIRDEYE_API_KEY.");
  return key;
}

async function birdeyeGet(port: BirdeyePort, path: string, key: string): Promise<Record<string, unknown>> {
  const response = await port.fetchImpl(`${BIRDEYE_API_BASE}${path}`, {
    method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json", "X-API-KEY": key, "x-chain": "solana" },
  });
  const payload: unknown = await response.json().catch(() => null);
  const root = record(payload);
  if (!response.ok || root == null || root.success !== true) {
    throw new Error(`Birdeye request failed (HTTP ${response.status}).`);
  }
  return root;
}

function requireMints(value: unknown): string[] {
  const list = Array.isArray(value) ? value.filter((mint): mint is string => typeof mint === "string") : [];
  const mints = list.map(mint => mint.trim()).filter(mint => isValidSolanaAddress(mint));
  if (mints.length === 0) throw new Error("birdeye_token_price requires at least one valid Solana mint.");
  return mints.slice(0, 10);
}

export async function executeBirdeyeRoutedTool(port: BirdeyePort, name: string, args: unknown): Promise<unknown> {
  const request = record(args) ?? {};
  const key = await requireKey(port);
  switch (name) {
    case "birdeye_token_price": {
      const mints = requireMints(request.mints);
      const found: Record<string, unknown> = {};
      const root = await birdeyeGet(port, `/defi/multi_price?list_address=${encodeURIComponent(mints.join(","))}`, key);
      const data = record(root.data) ?? {};
      for (const mint of mints) {
        const row = record(data[mint]);
        found[mint] = row == null ? null : {
          priceUsd: typeof row.value === "number" ? row.value : null,
          priceChange24hPct: typeof row.priceChange24h === "number" ? row.priceChange24h : null,
          updateUnixTime: typeof row.updateUnixTime === "number" ? row.updateUnixTime : null,
        };
      }
      return { ok: true, source: "birdeye", found, requested: mints.length };
    }
    case "birdeye_token_overview": {
      const mint = typeof request.mint === "string" ? request.mint.trim() : "";
      if (!isValidSolanaAddress(mint)) throw new Error("birdeye_token_overview requires a valid mint.");
      const root = await birdeyeGet(port, `/defi/token_overview?address=${encodeURIComponent(mint)}`, key);
      const data = record(root.data) ?? {};
      return {
        ok: true,
        source: "birdeye",
        mint,
        symbol: typeof data.symbol === "string" ? data.symbol : null,
        name: typeof data.name === "string" ? data.name : null,
        priceUsd: typeof data.price === "number" ? data.price : null,
        marketCapUsd: typeof data.mc === "number" ? data.mc : null,
        liquidityUsd: typeof data.liquidity === "number" ? data.liquidity : null,
        holders: typeof data.holder === "number" ? data.holder : null,
        volume24hUsd: typeof data.v24hUSD === "number" ? data.v24hUSD : null,
        priceChange24hPct: typeof data.priceChange24hPercent === "number" ? data.priceChange24hPercent : null,
      };
    }
    default:
      throw new Error(`Unknown Birdeye tool: ${name}`);
  }
}

export function createDefaultBirdeyePort(options: {
  readonly fetchImpl?: typeof fetch;
  readonly revealSecret?: (key: string) => Promise<string | null>;
  readonly env?: NodeJS.ProcessEnv;
} = {}): BirdeyePort {
  const env = options.env ?? process.env;
  const reveal = options.revealSecret ?? (async (key: string) => boxSecretsReveal(key));
  const hosted = () => resolveHostedProviderConfig(reveal, env);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return {
    fetchImpl: async (input, init) => {
      const config = await hosted();
      if (!config) return fetchImpl(input, init);
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (request.method !== "GET" || url.origin !== BIRDEYE_API_BASE || url.username || url.password || url.hash) throw new Error("Unsupported Birdeye endpoint");
      let body: unknown;
      if (url.pathname === "/defi/multi_price" && [...url.searchParams.keys()].length === 1 && url.searchParams.has("list_address")) {
        body = { action: "price", mints: url.searchParams.get("list_address")!.split(",") };
      } else if (url.pathname === "/defi/token_overview" && [...url.searchParams.keys()].length === 1 && url.searchParams.has("address")) {
        body = { action: "overview", mint: url.searchParams.get("address") };
      } else throw new Error("Unsupported Birdeye endpoint");
      return fetchImpl(`${config.url}/birdeye/request`, { method: "POST", redirect: "error", signal: request.signal,
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    },
    apiKey: async () => {
      const config = await hosted();
      if (config) return config.token;
      const fromEnv = env[BIRDEYE_API_KEY_ENV]?.trim();
      if (fromEnv) return fromEnv;
      if (options.revealSecret != null) {
        const stored = (await options.revealSecret(BIRDEYE_API_KEY_ENV))?.trim();
        if (stored) return stored;
      }
      return boxSecretsReveal(BIRDEYE_API_KEY_ENV);
    },
  };
}

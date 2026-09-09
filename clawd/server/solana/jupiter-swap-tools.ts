import type { RoutedToolDefinition } from "./solana-routed-tools.ts";

export const JUPITER_SWAP_TOOL_PROVIDER = "clawdbot-local-jupiter";

export type JupiterSwapToolDefinition = RoutedToolDefinition;

const ADDRESS_FIELD = {
  type: "string",
  description: "A base58 Solana token mint address (32-44 characters).",
};

const JUPITER_PRICE_SCHEMA = {
  type: "object",
  properties: {
    mints: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 50,
      description: "Up to 50 Solana mint addresses to price in USD.",
    },
  },
  required: ["mints"],
  additionalProperties: false,
};

const JUPITER_BUY_QUOTE_SCHEMA = {
  type: "object",
  properties: {
    output_mint: { ...ADDRESS_FIELD, description: "Mint address of the token to buy." },
    sol_amount: { type: "number", exclusiveMinimum: 0, maximum: 10, description: "How much SOL would be spent, e.g. 0.05." },
  },
  required: ["output_mint", "sol_amount"],
  additionalProperties: false,
};

const JUPITER_BUY_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", minLength: 1, description: "Name of a local app wallet (see solana_list_wallets)." },
    output_mint: { ...ADDRESS_FIELD, description: "Mint address of the token to buy." },
    sol_amount: { type: "number", exclusiveMinimum: 0, maximum: 10, description: "SOL to spend on this single purchase." },
    confirm: { type: "boolean", enum: [true], description: "Must be explicitly true; the swap spends real funds." },
  },
  required: ["wallet_name", "output_mint", "sol_amount", "confirm"],
  additionalProperties: false,
};

export const JUPITER_SWAP_ROUTED_TOOLS: readonly RoutedToolDefinition[] = [
  {
    name: "jupiter_token_price",
    toolName: "jupiter_token_price",
    providerIdentifier: JUPITER_SWAP_TOOL_PROVIDER,
    description: "Get real-time USD prices for up to 50 Solana tokens via the Jupiter Price API. Use before quoting or buying a token seen on the pump tape.",
    inputSchema: JUPITER_PRICE_SCHEMA,
  },
  {
    name: "jupiter_buy_quote",
    toolName: "jupiter_buy_quote",
    providerIdentifier: JUPITER_SWAP_TOOL_PROVIDER,
    description: "Quote (read-only, no transaction) how much of a token a given amount of SOL would buy on Jupiter, including expected fees. Use to preview a purchase.",
    inputSchema: JUPITER_BUY_QUOTE_SCHEMA,
  },
  {
    name: "jupiter_buy_token",
    toolName: "jupiter_buy_token",
    providerIdentifier: JUPITER_SWAP_TOOL_PROVIDER,
    description:
      "Buy a Solana token with SOL from one of the app's local wallets through Jupiter's best-price routing (Metis/JupiterZ/Dflow/OKX). Requires confirm:true and stays under a small per-trade cap. This executes a REAL on-chain swap.",
    inputSchema: JUPITER_BUY_SCHEMA,
  },
];

export function isJupiterSwapRoutedTool(name: unknown): name is string {
  return typeof name === "string" && JUPITER_SWAP_ROUTED_TOOLS.some((tool) => tool.name === name);
}

export function jupiterSwapRoutedTools(): readonly RoutedToolDefinition[] {
  return JUPITER_SWAP_ROUTED_TOOLS;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseJupiterSwapToolArgs(args: unknown): Record<string, unknown> {
  return record(args) ?? {};
}

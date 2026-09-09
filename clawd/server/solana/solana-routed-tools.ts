import { isValidSolanaAddress } from "./solana-service.ts";

export interface RoutedToolDefinition {
  name: string;
  toolName: string;
  providerIdentifier: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const PROVIDER = "clawdbot-local-solana";

const ADDRESS_FIELD = {
  type: "string",
  description: "A base58 Solana address (32-44 characters).",
};

const SOLANA_LIST_SCHEMA = { type: "object", properties: {}, additionalProperties: false };

const SOLANA_ASSETS_SCHEMA = {
  type: "object",
  properties: {
    owner_address: ADDRESS_FIELD,
    limit: { type: "integer", minimum: 1, maximum: 50, default: 12 },
  },
  required: ["owner_address"],
  additionalProperties: false,
};

const SOLANA_ASSET_SCHEMA = {
  type: "object",
  properties: { asset_id: ADDRESS_FIELD },
  required: ["asset_id"],
  additionalProperties: false,
};

const SOLANA_SEARCH_SCHEMA = {
  type: "object",
  properties: {
    owner_address: ADDRESS_FIELD,
    token_type: { type: "string", enum: ["all", "fungible", "nonFungible"], default: "all" },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 12 },
  },
  required: ["owner_address"],
  additionalProperties: false,
};

export const SOLANA_ROUTED_TOOLS: readonly RoutedToolDefinition[] = [
  {
    name: "solana_list_wallets",
    toolName: "solana_list_wallets",
    providerIdentifier: PROVIDER,
    description: "List the Solana wallets saved in this app (names and public addresses only). Read-only.",
    inputSchema: SOLANA_LIST_SCHEMA,
  },
  {
    name: "solana_wallet_assets",
    toolName: "solana_wallet_assets",
    providerIdentifier: PROVIDER,
    description:
      "Summarize the tokens/NFTs owned by a Solana address via the Helius DAS API (balances, symbols, floor prices where available). Read-only.",
    inputSchema: SOLANA_ASSETS_SCHEMA,
  },
  {
    name: "solana_asset_get",
    toolName: "solana_asset_get",
    providerIdentifier: PROVIDER,
    description: "Fetch one Solana asset (NFT or fungible token mint) by its id/mint address. Read-only.",
    inputSchema: SOLANA_ASSET_SCHEMA,
  },
  {
    name: "solana_assets_search",
    toolName: "solana_assets_search",
    providerIdentifier: PROVIDER,
    description: "Search the assets owned by a Solana address, optionally filtered to fungible tokens or NFTs. Read-only.",
    inputSchema: SOLANA_SEARCH_SCHEMA,
  },
];

export function isSolanaRoutedTool(name: unknown): name is string {
  return typeof name === "string" && SOLANA_ROUTED_TOOLS.some((tool) => tool.name === name);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function summarizeAssetPayload(payload: unknown, maxItems: number) {
  const root = record(payload);
  if (root == null) return payload;
  const rawItems = Array.isArray(root.items) ? root.items : [];
  const items = [];
  for (const raw of rawItems.slice(0, Math.max(1, maxItems))) {
    const item = record(raw);
    if (item == null) continue;
    const metadata = record(record(item.content)?.metadata);
    const tokenInfo = record(item.token_info);
    items.push({
      id: text(item.id),
      symbol: text(metadata?.symbol),
      name: text(metadata?.name),
      balance: typeof tokenInfo?.balance === "number" ? tokenInfo.balance : null,
      decimals: typeof tokenInfo?.decimals === "number" ? tokenInfo.decimals : null,
    });
  }
  const nativeBalance = record(root.nativeBalance);
  return {
    total: typeof root.total === "number" ? root.total : items.length,
    returned: items.length,
    truncated: rawItems.length > items.length,
    nativeBalanceSol: typeof nativeBalance?.lamports === "number" ? nativeBalance.lamports / 1e9 : null,
    items,
  };
}

export interface LocalSolanaWalletPort {
  listLocalWallets(): Promise<{ wallets: readonly { name: string; address: string; createdAt: string }[] }>;
  revealLocalWalletSecret(raw: unknown): Promise<string>;
  generateLocalWallet(raw: unknown): Promise<{ name: string; address: string; createdAt: string }>;
}

export type SolanaToolPort = {
  listWallets(): Promise<unknown>;
  getWalletAssets(raw: unknown): Promise<unknown>;
  getAsset(raw: unknown): Promise<unknown>;
  searchAssets(raw: unknown): Promise<unknown>;
} & Partial<LocalSolanaWalletPort>;

async function walletRows(port: SolanaToolPort) {
  const rows: { name: string; address: string | null }[] = [];
  const push = async (result: unknown) => {
    const wallets = record(result)?.wallets;
    if (!Array.isArray(wallets)) return;
    for (const raw of wallets) {
      const wallet = record(raw);
      if (wallet == null || typeof wallet.name !== "string") continue;
      rows.push({
        name: wallet.name,
        address: isValidSolanaAddress(wallet.solanaAddress)
          ? wallet.solanaAddress
          : typeof wallet.address === "string"
            ? wallet.address
            : null,
      });
    }
  };
  await push(port.listWallets == null ? null : await port.listWallets());
  await push(port.listLocalWallets == null ? null : await port.listLocalWallets());
  return rows;
}

function clampLimit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

export async function executeSolanaRoutedTool(port: SolanaToolPort, name: string, args: unknown) {
  const request = record(args) ?? {};
  switch (name) {
    case "solana_list_wallets": {
      const rows = await walletRows(port);
      return { ok: true, count: rows.length, wallets: rows };
    }
    case "solana_wallet_assets": {
      const ownerAddress = request.owner_address;
      if (!isValidSolanaAddress(ownerAddress)) throw new Error("solana_wallet_assets requires a valid owner_address.");
      const limit = clampLimit(request.limit, 12);
      const payload = await port.getWalletAssets({ ownerAddress, page: 1, limit });
      return { ok: true, ownerAddress, assets: summarizeAssetPayload(payload, limit) };
    }
    case "solana_asset_get": {
      const id = request.asset_id;
      if (!isValidSolanaAddress(id)) throw new Error("solana_asset_get requires a valid asset_id.");
      return { ok: true, asset: await port.getAsset({ id }) };
    }
    case "solana_assets_search": {
      const ownerAddress = request.owner_address;
      if (!isValidSolanaAddress(ownerAddress)) throw new Error("solana_assets_search requires a valid owner_address.");
      const tokenType = request.token_type === "fungible" || request.token_type === "nonFungible" ? request.token_type : "all";
      const limit = clampLimit(request.limit, 12);
      const payload = await port.searchAssets({ ownerAddress, tokenType, limit });
      return { ok: true, ownerAddress, tokenType, assets: summarizeAssetPayload(payload, limit) };
    }
    default:
      throw new Error(`Unknown Solana routed tool: ${name}`);
  }
}

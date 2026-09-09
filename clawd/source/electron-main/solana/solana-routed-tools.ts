import { agentDasFields, isValidSolanaAddress } from "./solana-service.js";

/**
 * Read-only Solana surfaces exposed to routed inference (including the
 * bring-your-own Telegram bridge). Nothing here can move funds or reveal
 * private keys: no create/generate/reveal operations are reachable.
 */
export interface SolanaReadOnlyPort {
  readonly listWallets?: () => Promise<unknown>;
  readonly listLocalWallets?: () => Promise<unknown>;
  readonly getWalletAssets: (raw: unknown) => Promise<unknown>;
  readonly getAsset: (raw: unknown) => Promise<unknown>;
  readonly searchAssets: (raw: unknown) => Promise<unknown>;
}

export interface SolanaRoutedTool {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const PROVIDER = "grok-bot-local-solana";

const ADDRESS_FIELD = {
  type: "string",
  description: "A base58 Solana address (32-44 characters).",
} as const;

const SOLANA_LIST_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const SOLANA_ASSETS_SCHEMA = {
  type: "object",
  properties: {
    owner_address: ADDRESS_FIELD,
    limit: { type: "integer", minimum: 1, maximum: 50, default: 12 },
  },
  required: ["owner_address"],
  additionalProperties: false,
} as const;

const SOLANA_ASSET_SCHEMA = {
  type: "object",
  properties: { asset_id: ADDRESS_FIELD },
  required: ["asset_id"],
  additionalProperties: false,
} as const;

const SOLANA_SEARCH_SCHEMA = {
  type: "object",
  properties: {
    owner_address: ADDRESS_FIELD,
    token_type: { type: "string", enum: ["all", "fungible", "nonFungible"], default: "all" },
    is_agent: { type: "boolean", description: "When true, search DAS for registered Metaplex agents (isAgent + MplCoreAsset)." },
    agent_token: ADDRESS_FIELD,
    asset_signer: ADDRESS_FIELD,
    limit: { type: "integer", minimum: 1, maximum: 50, default: 12 },
  },
  additionalProperties: false,
} as const;

export const SOLANA_ROUTED_TOOLS: readonly SolanaRoutedTool[] = [
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
    description: "Summarize the tokens/NFTs owned by a Solana address via the Helius DAS API (balances, symbols, floor prices where available). Read-only.",
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

export function isSolanaRoutedTool(name: unknown): boolean {
  return typeof name === "string" && SOLANA_ROUTED_TOOLS.some(tool => tool.name === name);
}

type AssetSummary = {
  readonly id: string | null;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly balance: number | null;
  readonly decimals: number | null;
  readonly is_agent: boolean | null;
  readonly asset_signer: string | null;
  readonly agent_token: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Projects verbose Helius DAS payloads onto a compact, model-friendly summary. */
export function summarizeAssetPayload(payload: unknown, maxItems: number): unknown {
  const root = record(payload);
  if (root == null) return payload;
  const rawItems = Array.isArray(root.items) ? root.items : [];
  const items: AssetSummary[] = [];
  for (const raw of rawItems.slice(0, Math.max(1, maxItems))) {
    const item = record(raw);
    if (item == null) continue;
    const metadata = record(record(item.content)?.metadata);
    const tokenInfo = record(item.token_info);
    const agent = agentDasFields(item);
    items.push({
      id: text(item.id),
      symbol: text(metadata?.symbol),
      name: text(metadata?.name),
      balance: typeof tokenInfo?.balance === "number" ? tokenInfo.balance : null,
      decimals: typeof tokenInfo?.decimals === "number" ? tokenInfo.decimals : null,
      is_agent: agent.is_agent,
      asset_signer: agent.asset_signer,
      agent_token: agent.agent_token,
    });
  }
  const nativeBalance = record(root.nativeBalance);
  return {
    total: typeof root.total === "number" ? root.total : items.length,
    returned: items.length,
    truncated: rawItems.length > items.length,
    nativeBalanceSol: typeof nativeBalance?.lamports === "number" ? nativeBalance.lamports / 1_000_000_000 : null,
    items,
  };
}

async function walletRows(port: SolanaReadOnlyPort): Promise<{ name: string; address: string | null }[]> {
  const rows: { name: string; address: string | null }[] = [];
  const push = async (result: unknown): Promise<void> => {
    const wallets = record(result)?.wallets;
    if (!Array.isArray(wallets)) return;
    for (const raw of wallets) {
      const wallet = record(raw);
      if (wallet == null || typeof wallet.name !== "string") continue;
      rows.push({ name: wallet.name, address: isValidSolanaAddress(wallet.solanaAddress) ? wallet.solanaAddress : typeof wallet.address === "string" ? wallet.address : null });
    }
  };
  await push(port.listWallets == null ? null : await port.listWallets());
  await push(port.listLocalWallets == null ? null : await port.listLocalWallets());
  return rows;
}

export async function executeSolanaRoutedTool(port: SolanaReadOnlyPort, name: string, args: unknown): Promise<unknown> {
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
      const isAgent = request.is_agent === true || request.isAgent === true;
      const agentToken = isValidSolanaAddress(request.agent_token) ? request.agent_token : isValidSolanaAddress(request.agentToken) ? request.agentToken : undefined;
      const assetSigner = isValidSolanaAddress(request.asset_signer) ? request.asset_signer : isValidSolanaAddress(request.assetSigner) ? request.assetSigner : undefined;
      if (!isAgent && agentToken == null && assetSigner == null && !isValidSolanaAddress(ownerAddress)) {
        throw new Error("solana_assets_search requires a valid owner_address.");
      }
      const tokenType = request.token_type === "fungible" || request.token_type === "nonFungible" ? request.token_type : "all";
      const limit = clampLimit(request.limit, 12);
      const payload = await port.searchAssets({
        ...(isValidSolanaAddress(ownerAddress) ? { ownerAddress } : {}),
        tokenType,
        limit,
        ...(isAgent ? { isAgent: true } : {}),
        ...(agentToken == null ? {} : { agentToken }),
        ...(assetSigner == null ? {} : { assetSigner }),
      });
      return { ok: true, ownerAddress: isValidSolanaAddress(ownerAddress) ? ownerAddress : null, tokenType, isAgent, assets: summarizeAssetPayload(payload, limit) };
    }
    default:
      throw new Error(`Unknown Solana routed tool: ${name}`);
  }
}

function clampLimit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

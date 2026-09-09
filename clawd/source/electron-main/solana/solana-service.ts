import { isValidSolanaAddress as isWalletCoreSolanaAddress } from "../../shared/solana-wallet-core.js";
const HELIUS_TOKEN_TYPES = new Set(["all", "fungible", "nonFungible", "regularNft", "compressedNft"]);
export const SOLANA_WALLET_REGISTRY_KEY = "solana.wallet-registry.v1";
export const HELIUS_MAINNET_RPC_BASE = "https://mainnet.helius-rpc.com";
export const PHANTOM_SECRET_KEYS = ["PHANTOM_ORGANIZATION_ID", "PHANTOM_APP_ID", "PHANTOM_API_PRIVATE_KEY"] as const;
export const HELIUS_SECRET_KEY = "HELIUS_API_KEY";
export type HeliusTokenType = "all" | "fungible" | "nonFungible" | "regularNft" | "compressedNft";

export interface SolanaWalletRecord {
  readonly walletId: string;
  readonly name: string;
  readonly solanaAddress: string | null;
  readonly addresses: ReadonlyArray<{ readonly addressType: string; readonly address: string }>;
  readonly createdAt: string;
}

export interface PhantomSdkInstance {
  createWallet(name?: string): Promise<{ walletId: string; addresses: ReadonlyArray<{ addressType: string; address: string }> }>;
  getWallets(limit: number, offset: number): Promise<{ totalCount: number; wallets: ReadonlyArray<{ walletId: string; walletName?: string }> }>;
  getWalletAddresses(walletId: string, derivationPaths?: readonly string[]): Promise<ReadonlyArray<{ addressType: string; address: string }>>;
}

export interface PhantomSdkModule {
  ServerSDK: new (options: { organizationId: string; apiPrivateKey: string; appId: string }) => PhantomSdkInstance;
}

export interface SolanaServiceDeps {
  readonly revealSecret: (key: string) => Promise<string | null>;
  readonly readRegistry: () => Promise<unknown>;
  readonly writeRegistry: (value: unknown) => Promise<void>;
  readonly loadServerSdk: () => Promise<PhantomSdkModule>;
  readonly fetchImpl?: typeof fetch;
  readonly heliusRpcBase?: string;
  readonly envHeliusKey?: string | undefined;
  readonly envHeliusRpcUrl?: string | undefined;
}

export interface SolanaStatus {
  readonly phantomConfigured: boolean;
  readonly heliusConfigured: boolean;
  readonly missingPhantom: readonly string[];
  readonly walletCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function isValidSolanaAddress(value: unknown): value is string {
  return isWalletCoreSolanaAddress(value);
}

/** Copies DAS agent-index fields in both snake_case and camelCase. */
export function agentDasFields(payload: unknown): { is_agent: boolean | null; asset_signer: string | null; agent_token: string | null; isAgent: boolean | null; assetSigner: string | null; agentToken: string | null } {
  const root = isRecord(payload) ? payload : {};
  const isAgent = root.is_agent === true || root.isAgent === true ? true : root.is_agent === false || root.isAgent === false ? false : null;
  const assetSigner = typeof root.asset_signer === "string" ? root.asset_signer : typeof root.assetSigner === "string" ? root.assetSigner : null;
  const agentToken = typeof root.agent_token === "string" ? root.agent_token : typeof root.agentToken === "string" ? root.agentToken : null;
  return { is_agent: isAgent, asset_signer: assetSigner, agent_token: agentToken, isAgent, assetSigner, agentToken };
}

export function annotateDasAgentFields(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  const items = Array.isArray(payload.items)
    ? payload.items.map(item => isRecord(item) ? { ...item, ...agentDasFields(item) } : item)
    : payload.items;
  return { ...payload, ...agentDasFields(payload), ...(items === undefined ? {} : { items }) };
}

export function normalizeWalletName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function readWalletRegistry(value: unknown): SolanaWalletRecord[] {
  if (!isRecord(value) || !Array.isArray(value.wallets)) return [];
  const wallets: SolanaWalletRecord[] = [];
  for (const entry of value.wallets) {
    if (!isRecord(entry) || typeof entry.walletId !== "string" || entry.walletId.length === 0) continue;
    const addresses = Array.isArray(entry.addresses)
      ? entry.addresses.filter((item): item is { addressType: string; address: string } => isRecord(item) && typeof item.addressType === "string" && typeof item.address === "string")
      : [];
    wallets.push({
      walletId: entry.walletId,
      name: typeof entry.name === "string" ? entry.name : entry.walletId,
      solanaAddress: isValidSolanaAddress(entry.solanaAddress) ? entry.solanaAddress : addresses.find(a => a.addressType === "Solana")?.address ?? null,
      addresses,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    });
  }
  return wallets;
}

function firstSecret(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function createSolanaService(deps: SolanaServiceDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const heliusBase = (deps.heliusRpcBase ?? HELIUS_MAINNET_RPC_BASE).replace(/\/+$/, "");
  let sdkPromise: Promise<PhantomSdkInstance> | undefined;

  const reveal = async (key: string): Promise<string | null> => firstSecret(await deps.revealSecret(key));

  const phantomSdk = async (): Promise<PhantomSdkInstance> => {
    if (sdkPromise != null) return sdkPromise;
    sdkPromise = (async () => {
      const [module, organizationId, appId, apiPrivateKey] = await Promise.all([
        deps.loadServerSdk(),
        reveal(PHANTOM_SECRET_KEYS[0]),
        reveal(PHANTOM_SECRET_KEYS[1]),
        reveal(PHANTOM_SECRET_KEYS[2]),
      ]);
      if (organizationId == null || appId == null || apiPrivateKey == null) {
        throw new Error("Phantom wallet infrastructure is not configured. Save PHANTOM_ORGANIZATION_ID, PHANTOM_APP_ID and PHANTOM_API_PRIVATE_KEY in the Solana panel first.");
      }
      return new module.ServerSDK({ organizationId, apiPrivateKey, appId });
    })();
    return await sdkPromise;
  };

  const heliusKey = async (): Promise<string> => {
    const key = await reveal(HELIUS_SECRET_KEY) ?? firstSecret(deps.envHeliusKey);
    if (key == null) throw new Error("Helius is not configured. Set HELIUS_RPC_URL or HELIUS_API_KEY (env or Settings → Solana panel).");
    return key;
  };

  const heliusEndpoint = async (): Promise<string> => {
    const explicit = firstSecret(deps.envHeliusRpcUrl) ?? await reveal("HELIUS_RPC_URL");
    if (explicit != null) return explicit;
    const key = await reveal(HELIUS_SECRET_KEY) ?? firstSecret(deps.envHeliusKey);
    if (key == null) throw new Error("Helius is not configured. Set HELIUS_RPC_URL or HELIUS_API_KEY (env or Settings → Solana panel).");
    return `${heliusBase}/?api-key=${encodeURIComponent(key)}`;
  };

  const heliusRpc = async <T>(method: string, params: unknown): Promise<T> => {
    const endpoint = await heliusEndpoint();
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "sand-solana", method, params }),
      });
    } catch (error) {
      throw new Error(`Helius request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const rpcError = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      const detail = rpcError != null && typeof rpcError.message === "string" ? rpcError.message : `HTTP ${response.status}`;
      throw new Error(`Helius ${method} failed: ${detail}`);
    }
    if (isRecord(payload) && isRecord(payload.error)) {
      const detail = typeof payload.error.message === "string" ? payload.error.message : JSON.stringify(payload.error);
      throw new Error(`Helius ${method} failed: ${detail}`);
    }
    return (isRecord(payload) ? payload.result : payload) as T;
  };

  const persistWallets = async (wallets: readonly SolanaWalletRecord[]): Promise<void> => {
    await deps.writeRegistry({ schemaVersion: 1, wallets });
  };

  return {
    async getStatus(): Promise<SolanaStatus> {
      const [organizationId, appId, apiPrivateKey, helius, heliusRpcUrl, registry] = await Promise.all([
        reveal(PHANTOM_SECRET_KEYS[0]),
        reveal(PHANTOM_SECRET_KEYS[1]),
        reveal(PHANTOM_SECRET_KEYS[2]),
        reveal(HELIUS_SECRET_KEY),
        reveal("HELIUS_RPC_URL"),
        deps.readRegistry(),
      ]);
      const missingPhantom = [PHANTOM_SECRET_KEYS[0], PHANTOM_SECRET_KEYS[1], PHANTOM_SECRET_KEYS[2]].filter((_, index) => [organizationId, appId, apiPrivateKey][index] == null);
      return {
        phantomConfigured: missingPhantom.length === 0,
        heliusConfigured: helius != null || heliusRpcUrl != null || firstSecret(deps.envHeliusKey) != null || firstSecret(deps.envHeliusRpcUrl) != null,
        missingPhantom,
        walletCount: readWalletRegistry(registry).length,
      };
    },

    async createWallet(raw: unknown): Promise<SolanaWalletRecord> {
      const name = normalizeWalletName(isRecord(raw) ? raw.name : undefined);
      if (name.length === 0) throw new Error("A wallet needs a name of 1-120 characters.");
      const sdk = await phantomSdk();
      const created = await sdk.createWallet(name);
      if (typeof created?.walletId !== "string" || created.walletId.length === 0) throw new Error("Phantom did not return a wallet id.");
      const addresses = (Array.isArray(created.addresses) ? created.addresses : []).filter(entry => isRecord(entry) && typeof entry.addressType === "string" && typeof entry.address === "string") as Array<{ addressType: string; address: string }>;
      const record: SolanaWalletRecord = {
        walletId: created.walletId,
        name,
        solanaAddress: addresses.find(entry => entry.addressType === "Solana")?.address ?? null,
        addresses,
        createdAt: new Date().toISOString(),
      };
      const registry = readWalletRegistry(await deps.readRegistry());
      await persistWallets([record, ...registry.filter(entry => entry.walletId !== record.walletId)]);
      return record;
    },

    async listWallets(): Promise<{ wallets: readonly SolanaWalletRecord[] }> {
      return { wallets: readWalletRegistry(await deps.readRegistry()) };
    },

    async getWalletAssets(raw: unknown): Promise<unknown> {
      const request = isRecord(raw) ? raw : {};
      const ownerAddress = request.ownerAddress;
      if (!isValidSolanaAddress(ownerAddress)) throw new Error("getWalletAssets requires a valid Solana owner address.");
      const page = typeof request.page === "number" && Number.isInteger(request.page) && request.page > 0 ? request.page : 1;
      const limit = typeof request.limit === "number" && Number.isInteger(request.limit) && request.limit > 0 ? Math.min(request.limit, 100) : 24;
      return annotateDasAgentFields(await heliusRpc("getAssetsByOwner", {
        ownerAddress,
        page,
        limit,
        sortBy: { sortBy: "recent_action", sortDirection: "desc" },
        options: {
          showFungible: request.showFungible !== false,
          showNativeBalance: request.showNativeBalance !== false,
          showCollectionMetadata: false,
          showZeroBalance: false,
        },
      }));
    },

    async getAsset(raw: unknown): Promise<unknown> {
      const id = isRecord(raw) ? raw.id : undefined;
      if (!isValidSolanaAddress(id)) throw new Error("getAsset requires a valid Solana asset id.");
      return annotateDasAgentFields(await heliusRpc("getAsset", { id, options: { showCollectionMetadata: false, showFungible: true } }));
    },

    async searchAssets(raw: unknown): Promise<unknown> {
      const request = isRecord(raw) ? raw : {};
      const tokenType = typeof request.tokenType === "string" && HELIUS_TOKEN_TYPES.has(request.tokenType) ? request.tokenType : "all";
      const limit = typeof request.limit === "number" && Number.isInteger(request.limit) && request.limit > 0 ? Math.min(request.limit, 100) : 24;
      const params: Record<string, unknown> = { tokenType, limit, page: 1 };
      if (request.isAgent === true || request.is_agent === true) {
        params.interface = "MplCoreAsset";
        params.isAgent = true;
      } else if (!isValidSolanaAddress(request.ownerAddress) && !isValidSolanaAddress(request.agentToken) && !isValidSolanaAddress(request.agent_token) && !isValidSolanaAddress(request.assetSigner) && !isValidSolanaAddress(request.asset_signer)) {
        throw new Error("searchAssets requires a valid Solana owner address.");
      }
      if (isValidSolanaAddress(request.ownerAddress)) params.ownerAddress = request.ownerAddress;
      if (isValidSolanaAddress(request.agentToken) || isValidSolanaAddress(request.agent_token)) {
        params.agentToken = isValidSolanaAddress(request.agentToken) ? request.agentToken : request.agent_token;
      }
      if (isValidSolanaAddress(request.assetSigner) || isValidSolanaAddress(request.asset_signer)) {
        params.assetSigner = isValidSolanaAddress(request.assetSigner) ? request.assetSigner : request.asset_signer;
      }
      return annotateDasAgentFields(await heliusRpc("searchAssets", params));
    },
  };
}

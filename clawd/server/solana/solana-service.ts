const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HELIUS_TOKEN_TYPES = new Set(["all", "fungible", "nonFungible", "regularNft", "compressedNft"]);
const HELIUS_MAINNET_RPC_BASE = "https://mainnet.helius-rpc.com";

export const PHANTOM_SECRET_KEYS = ["PHANTOM_ORGANIZATION_ID", "PHANTOM_APP_ID", "PHANTOM_API_PRIVATE_KEY"] as const;
export const HELIUS_SECRET_KEY = "HELIUS_API_KEY";

type FetchLike = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

export function isValidSolanaAddress(value: unknown): value is string {
  return typeof value === "string" && SOLANA_ADDRESS_PATTERN.test(value);
}

function normalizeWalletName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

export interface SolanaWalletRecord {
  walletId: string;
  name: string;
  solanaAddress: string | null;
  addresses: { addressType: string; address: string }[];
  createdAt: string;
}

export function readWalletRegistry(value: unknown): SolanaWalletRecord[] {
  if (!isRecord(value) || !Array.isArray(value.wallets)) return [];
  const wallets: SolanaWalletRecord[] = [];
  for (const entry of value.wallets) {
    if (!isRecord(entry) || typeof entry.walletId !== "string" || entry.walletId.length === 0) continue;
    const addresses = Array.isArray(entry.addresses)
      ? (entry.addresses as unknown[])
          .filter(
            (item): item is { addressType: string; address: string } =>
              isRecord(item) &&
              typeof (item as Record<string, unknown>).addressType === "string" &&
              typeof (item as Record<string, unknown>).address === "string",
          )
          .map((item) => ({ addressType: item.addressType, address: item.address }))
      : [];
    wallets.push({
      walletId: entry.walletId,
      name: typeof entry.name === "string" ? entry.name : entry.walletId,
      solanaAddress: isValidSolanaAddress(entry.solanaAddress)
        ? entry.solanaAddress
        : (addresses.find((a) => a.addressType === "Solana")?.address ?? null),
      addresses,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    });
  }
  return wallets;
}

function firstSecret(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export interface SolanaServiceDeps {
  revealSecret: (key: string) => Promise<unknown>;
  readRegistry: () => Promise<unknown>;
  writeRegistry: (value: unknown) => Promise<void>;
  loadServerSdk: () => Promise<{ ServerSDK: new (options: { organizationId: string; apiPrivateKey: string; appId: string }) => PhantomServerSdk }>;
  heliusRpcBase?: string | undefined;
  envRpcUrl?: string | undefined;
  envHeliusKey?: string | undefined;
  hostedAccess?: () => { origin: string; token: string } | null;
  fetchImpl?: FetchLike | undefined;
}

interface PhantomServerSdk {
  createWallet(name: string): Promise<unknown>;
}

export function createSolanaService(deps: SolanaServiceDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const heliusBase = (deps.heliusRpcBase ?? HELIUS_MAINNET_RPC_BASE).replace(/\/+$/, "");
  let sdkPromise: Promise<PhantomServerSdk> | undefined;

  const reveal = async (key: string): Promise<string | null> => firstSecret(await deps.revealSecret(key));

  const phantomSdk = async (): Promise<PhantomServerSdk> => {
    if (sdkPromise != null) return sdkPromise;
    sdkPromise = (async () => {
      const [module, organizationId, appId, apiPrivateKey] = await Promise.all([
        deps.loadServerSdk(),
        reveal(PHANTOM_SECRET_KEYS[0]),
        reveal(PHANTOM_SECRET_KEYS[1]),
        reveal(PHANTOM_SECRET_KEYS[2]),
      ]);
      if (organizationId == null || appId == null || apiPrivateKey == null) {
        throw new Error(
          "Phantom wallet infrastructure is not configured. Save PHANTOM_ORGANIZATION_ID, PHANTOM_APP_ID and PHANTOM_API_PRIVATE_KEY in the Solana panel first.",
        );
      }
      return new module.ServerSDK({ organizationId, apiPrivateKey, appId });
    })();
    return await sdkPromise;
  };

  const heliusKey = async (): Promise<string> => {
    const key = (await reveal(HELIUS_SECRET_KEY)) ?? firstSecret(deps.envHeliusKey);
    if (key == null) throw new Error("Helius is not configured. Save HELIUS_API_KEY in the Solana panel first.");
    return key;
  };

  const heliusRpc = async <T = unknown>(method: string, params: unknown): Promise<T> => {
    const hosted = deps.hostedAccess?.();
    const rpcUrl = firstSecret(deps.envRpcUrl);
    const key = hosted || rpcUrl ? null : await heliusKey();
    const endpoint = hosted ? `${hosted.origin}${method === "getBalance" ? "/solana/rpc" : "/helius/rpc"}` : rpcUrl ?? `${heliusBase}/?api-key=${encodeURIComponent(key!)}`;
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: { "content-type": "application/json", ...(hosted ? { authorization: `Bearer ${hosted.token}` } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: "clawdbot-solana", method, params }),
      });
    } catch {
      throw new Error("Solana RPC request failed");
    }
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
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
    async getStatus() {
      const [organizationId, appId, apiPrivateKey, helius, registry] = await Promise.all([
        reveal(PHANTOM_SECRET_KEYS[0]),
        reveal(PHANTOM_SECRET_KEYS[1]),
        reveal(PHANTOM_SECRET_KEYS[2]),
        reveal(HELIUS_SECRET_KEY),
        deps.readRegistry(),
      ]);
      const missingPhantom = [PHANTOM_SECRET_KEYS[0], PHANTOM_SECRET_KEYS[1], PHANTOM_SECRET_KEYS[2]].filter(
        (_key, index) => [organizationId, appId, apiPrivateKey][index] == null,
      );
      return {
        phantomConfigured: missingPhantom.length === 0,
        heliusConfigured: firstSecret(deps.envRpcUrl) != null || Boolean(deps.hostedAccess?.()) || helius != null || firstSecret(deps.envHeliusKey) != null,
        missingPhantom,
        walletCount: readWalletRegistry(registry).length,
      };
    },
    async createWallet(raw: unknown): Promise<SolanaWalletRecord> {
      const name = normalizeWalletName(isRecord(raw) ? raw.name : undefined);
      if (name.length === 0) throw new Error("A wallet needs a name of 1-120 characters.");
      const sdk = await phantomSdk();
      const created = await sdk.createWallet(name);
      const row = isRecord(created) ? created : null;
      if (row == null || typeof row.walletId !== "string" || row.walletId.length === 0) throw new Error("Phantom did not return a wallet id.");
      const addresses = (Array.isArray(row.addresses) ? (row.addresses as unknown[]) : [])
        .filter(
          (entry): entry is { addressType: string; address: string } =>
            isRecord(entry) &&
            typeof (entry as Record<string, unknown>).addressType === "string" &&
            typeof (entry as Record<string, unknown>).address === "string",
        )
        .map((entry) => ({ addressType: entry.addressType, address: entry.address }));
      const record: SolanaWalletRecord = {
        walletId: String(row.walletId),
        name,
        solanaAddress: addresses.find((entry) => entry.addressType === "Solana")?.address ?? null,
        addresses,
        createdAt: new Date().toISOString(),
      };
      const registry = readWalletRegistry(await deps.readRegistry());
      await persistWallets([record, ...registry.filter((entry) => entry.walletId !== record.walletId)]);
      return record;
    },
    async listWallets() {
      return { wallets: readWalletRegistry(await deps.readRegistry()) };
    },
    async getWalletAssets(raw: unknown) {
      const request = isRecord(raw) ? raw : {};
      const ownerAddress = request.ownerAddress;
      if (!isValidSolanaAddress(ownerAddress)) throw new Error("getWalletAssets requires a valid Solana owner address.");
      const page = typeof request.page === "number" && Number.isInteger(request.page) && request.page > 0 ? request.page : 1;
      const limit = typeof request.limit === "number" && Number.isInteger(request.limit) && request.limit > 0 ? Math.min(request.limit, 100) : 24;
      return await heliusRpc("getAssetsByOwner", {
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
      });
    },
    async getAsset(raw: unknown) {
      const id = isRecord(raw) ? raw.id : undefined;
      if (!isValidSolanaAddress(id)) throw new Error("getAsset requires a valid Solana asset id.");
      return await heliusRpc("getAsset", { id, options: { showCollectionMetadata: false, showFungible: true } });
    },
    async searchAssets(raw: unknown) {
      const request = isRecord(raw) ? raw : {};
      if (!isValidSolanaAddress(request.ownerAddress)) throw new Error("searchAssets requires a valid Solana owner address.");
      const tokenType = typeof request.tokenType === "string" && HELIUS_TOKEN_TYPES.has(request.tokenType) ? request.tokenType : "all";
      const limit = typeof request.limit === "number" && Number.isInteger(request.limit) && request.limit > 0 ? Math.min(request.limit, 100) : 24;
      return await heliusRpc("searchAssets", { ownerAddress: request.ownerAddress, tokenType, limit, page: 1 });
    },
    async getBalanceLamports(address: string): Promise<number | null> {
      if (!isValidSolanaAddress(address)) throw new Error("getBalanceLamports requires a valid Solana address.");
      try {
        const result = await heliusRpc<unknown>("getBalance", [address]);
        // Solana JSON-RPC getBalance returns { context, value } where value is lamports.
        if (typeof result === "number" && Number.isFinite(result)) return result;
        if (isRecord(result) && typeof result.value === "number" && Number.isFinite(result.value)) return result.value;
        return null;
      } catch {
        return null;
      }
    },
  };
}

export type SolanaService = ReturnType<typeof createSolanaService>;

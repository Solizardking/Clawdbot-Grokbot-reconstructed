import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { DATA_DIR } from "../config.ts";
import { createJupiterSwapClient, createJupiterSwapService, JUPITER_SECRET_KEY, type JupiterSwapService } from "./jupiter-swap.ts";
import { createLocalSolanaWalletStore, type LocalSolanaWalletStore } from "./local-wallets.ts";
import { createPumpTapeStore, ensurePumpTape, type PumpTapeStore } from "./pump-tape.ts";
import { createAesGcmSafeStorage } from "./seal-codec.ts";
import {
  createSolanaService,
  HELIUS_SECRET_KEY,
  PHANTOM_SECRET_KEYS,
  type SolanaService,
} from "./solana-service.ts";
import { executeSolanaFamilyTool, type SolanaFamilyPorts } from "./tools.ts";

const WALLET_STORE = "solana-wallets.json";
const REGISTRY_STORE = "solana-registry.json";
const SEAL_KEY_FILE = "solana-seal.key";

function firstSecret(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export interface SolanaRuntimeSecrets {
  heliusApiKey?: string;
  phantomOrganizationId?: string;
  phantomAppId?: string;
  phantomApiPrivateKey?: string;
  jupiterApiKey?: string;
}

function secretsFromEnv(env: NodeJS.ProcessEnv): SolanaRuntimeSecrets {
  return {
    heliusApiKey: firstSecret(env.HELIUS_API_KEY) ?? undefined,
    phantomOrganizationId: firstSecret(env.PHANTOM_ORGANIZATION_ID) ?? undefined,
    phantomAppId: firstSecret(env.PHANTOM_APP_ID) ?? undefined,
    phantomApiPrivateKey: firstSecret(env.PHANTOM_API_PRIVATE_KEY) ?? undefined,
    jupiterApiKey: firstSecret(env.JUPITER_API_KEY) ?? undefined,
  };
}

export function createSolanaRuntime(options?: {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  secrets?: SolanaRuntimeSecrets;
  fetchImpl?: typeof fetch;
  startRelay?: boolean;
  hostedAccess?: () => { origin: string; token: string } | null;
}) {
  const env = options?.env ?? process.env;
  const dataDir = options?.dataDir ?? DATA_DIR;
  const walletPath = join(dataDir, WALLET_STORE);
  const registryPath = join(dataDir, REGISTRY_STORE);
  const sealPath = join(dataDir, SEAL_KEY_FILE);
  const fileSecrets = { ...secretsFromEnv(env), ...options?.secrets };

  const localWallets: LocalSolanaWalletStore = createLocalSolanaWalletStore({
    safeStorage: createAesGcmSafeStorage({ keyPath: sealPath, envKey: env.OMB_SOLANA_SEAL_KEY }),
    storePath: walletPath,
  });

  const revealSecret = async (key: string): Promise<string | null> => {
    if (key === HELIUS_SECRET_KEY) return firstSecret(fileSecrets.heliusApiKey);
    if (key === JUPITER_SECRET_KEY) return firstSecret(fileSecrets.jupiterApiKey);
    if (key === PHANTOM_SECRET_KEYS[0]) return firstSecret(fileSecrets.phantomOrganizationId);
    if (key === PHANTOM_SECRET_KEYS[1]) return firstSecret(fileSecrets.phantomAppId);
    if (key === PHANTOM_SECRET_KEYS[2]) return firstSecret(fileSecrets.phantomApiPrivateKey);
    return null;
  };

  const readRegistry = async (): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(registryPath, "utf8")) as unknown;
    } catch {
      return { schemaVersion: 1, wallets: [] };
    }
  };

  const writeRegistry = async (value: unknown): Promise<void> => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(registryPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  };

  const solana: SolanaService = createSolanaService({
    revealSecret,
    readRegistry,
    writeRegistry,
    envHeliusKey: fileSecrets.heliusApiKey,
    envRpcUrl: env.SOLANA_TRACKER_RPC_URL || env.SOLANA_RPC_URL || env.RPC_URL || env.HELIUS_RPC_URL || env.SOLANA_TRACKER_SECURE_RPC || env.SECURE_RPC_URL,
    hostedAccess: options?.hostedAccess,
    fetchImpl: options?.fetchImpl,
    loadServerSdk: async () => {
      throw new Error("Phantom Server SDK is not installed. Local wallets and Helius still work without it.");
    },
  });

  const jupiter: JupiterSwapService = createJupiterSwapService({
    revealSecret,
    localWallets,
    env,
    getSolBalanceLamports: (address) => solana.getBalanceLamports(address),
    ...(options?.fetchImpl
      ? {
          client: createJupiterSwapClient({
            apiKey: async () => firstSecret(fileSecrets.jupiterApiKey),
            fetchImpl: options.fetchImpl,
          }),
        }
      : {}),
  });

  let pumpStore: PumpTapeStore = createPumpTapeStore();
  if (options?.startRelay !== false) {
    try {
      pumpStore = ensurePumpTape().store;
    } catch (error) {
      console.error(
        `[solana] pump tape relay failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const ports: SolanaFamilyPorts = {
    solana: {
      listWallets: () => solana.listWallets(),
      getWalletAssets: (raw) => solana.getWalletAssets(raw),
      getAsset: (raw) => solana.getAsset(raw),
      searchAssets: (raw) => solana.searchAssets(raw),
      listLocalWallets: () => localWallets.listLocalWallets(),
      revealLocalWalletSecret: (raw) => localWallets.revealLocalWalletSecret(raw),
      generateLocalWallet: (raw) => localWallets.generateLocalWallet(raw),
    },
    jupiter,
    pumpStore,
    pumpEnv: env,
    pumpFetch: options?.fetchImpl,
  };

  return {
    localWallets,
    solana,
    jupiter,
    pumpStore,
    secrets: fileSecrets,
    applySecrets(patch: SolanaRuntimeSecrets) {
      Object.assign(fileSecrets, patch);
    },
    executeTool(name: string, args: unknown) {
      return executeSolanaFamilyTool(ports, name, args);
    },
  };
}

export type SolanaRuntime = ReturnType<typeof createSolanaRuntime>;

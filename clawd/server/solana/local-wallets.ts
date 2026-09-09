import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import bs58 from "bs58";

/** Structural subset of Electron's safeStorage used for wallet-secret sealing. */
export interface SafeStorageCodecPort {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export class SolanaSecureStorageUnavailableError extends Error {
  constructor() {
    super("OS secure storage is unavailable; Solana wallet secrets cannot be stored.");
  }
}

export class SolanaWalletNameTakenError extends Error {
  constructor() {
    super("A local wallet with this name already exists.");
  }
}

export interface StoredSolanaWallet {
  readonly name: string;
  readonly address: string;
  readonly createdAt: string;
  readonly secret: string;
}

export function solanaKeypairFromSeed(seed: Buffer): { address: string; secretKeyBase58: string } {
  if (seed.length !== 32) throw new Error("A Solana seed must be exactly 32 bytes.");
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKeyDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const publicKey = Buffer.from(publicKeyDer).subarray(-32);
  return { address: bs58.encode(publicKey), secretKeyBase58: bs58.encode(Buffer.concat([seed, publicKey])) };
}

function isStoredWallet(value: unknown): value is StoredSolanaWallet {
  return (
    typeof value === "object" &&
    value != null &&
    typeof (value as Record<string, unknown>).name === "string" &&
    typeof (value as Record<string, unknown>).address === "string" &&
    typeof (value as Record<string, unknown>).secret === "string"
  );
}

function normalizeWalletName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function createLocalSolanaWalletStore(deps: {
  safeStorage: SafeStorageCodecPort;
  storePath: string;
  randomSeed?: (() => Buffer) | undefined;
  now?: (() => Date) | undefined;
}) {
  const randomSeed = deps.randomSeed ?? (() => randomBytes(32));
  const now = deps.now ?? (() => new Date());

  const load = async (): Promise<StoredSolanaWallet[]> => {
    let raw: string;
    try {
      raw = await readFile(deps.storePath, "utf8");
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed == null || !Array.isArray((parsed as Record<string, unknown>).wallets)) return [];
      return ((parsed as Record<string, unknown>).wallets as unknown[]).filter(isStoredWallet);
    } catch {
      return [];
    }
  };

  const persist = async (wallets: readonly StoredSolanaWallet[]): Promise<void> => {
    await mkdir(dirname(deps.storePath), { recursive: true });
    const temporary = `${deps.storePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, wallets }, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, deps.storePath);
  };

  return {
    async generateLocalWallet(raw: unknown): Promise<{ name: string; address: string; createdAt: string }> {
      const name = normalizeWalletName(typeof raw === "object" && raw != null ? (raw as Record<string, unknown>).name : undefined);
      if (name.length === 0) throw new Error("A wallet needs a name of 1-120 characters.");
      if (!deps.safeStorage.isEncryptionAvailable()) throw new SolanaSecureStorageUnavailableError();
      const existing = await load();
      if (existing.some((wallet) => wallet.name === name)) throw new SolanaWalletNameTakenError();
      const seed = randomSeed();
      const { address, secretKeyBase58 } = solanaKeypairFromSeed(seed);
      const record: StoredSolanaWallet = {
        name,
        address,
        createdAt: now().toISOString(),
        secret: deps.safeStorage.encryptString(secretKeyBase58).toString("base64"),
      };
      await persist([record, ...existing]);
      return { name, address, createdAt: record.createdAt };
    },
    async listLocalWallets() {
      const wallets = await load();
      return { wallets: wallets.map(({ name, address, createdAt }) => ({ name, address, createdAt })) };
    },
    async revealLocalWalletSecret(raw: unknown): Promise<string> {
      const name = normalizeWalletName(typeof raw === "object" && raw != null ? (raw as Record<string, unknown>).name : undefined);
      const wallet = (await load()).find((entry) => entry.name === name);
      if (wallet == null) throw new Error(`No local wallet named "${name}".`);
      if (!deps.safeStorage.isEncryptionAvailable()) throw new SolanaSecureStorageUnavailableError();
      return deps.safeStorage.decryptString(Buffer.from(wallet.secret, "base64"));
    },
  };
}

export type LocalSolanaWalletStore = ReturnType<typeof createLocalSolanaWalletStore>;

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import bs58 from "bs58";
import type { SecureStorageCodec } from "../secrets/secret-store.js";
import { decodeSolanaPrivateKey, encodeSolanaAddress } from "../../shared/solana-wallet-core.js";
import { normalizeWalletName } from "./solana-service.js";

export class SolanaSecureStorageUnavailableError extends Error {
  constructor() { super("OS secure storage is unavailable; Solana wallet secrets cannot be stored."); }
}
export class SolanaWalletNameTakenError extends Error {
  constructor() { super("A local wallet with this name already exists."); }
}

export interface LocalSolanaWalletRecord {
  readonly name: string;
  readonly address: string;
  readonly createdAt: string;
}

interface StoredLocalWallet extends LocalSolanaWalletRecord {
  readonly secret: string;
}

export interface LocalSolanaWalletStoreDeps {
  readonly safeStorage: SecureStorageCodec;
  readonly storePath: string;
  readonly randomSeed?: () => Buffer;
  readonly now?: () => Date;
}

/** Derives a Solana keypair (address + 64-byte base58 secret) from a 32-byte Ed25519 seed. */
export function solanaKeypairFromSeed(seed: Buffer): { address: string; secretKeyBase58: string } {
  if (seed.length !== 32) throw new Error("A Solana seed must be exactly 32 bytes.");
  const decoded = decodeSolanaPrivateKey(bs58.encode(seed));
  return { address: encodeSolanaAddress(decoded.publicKey), secretKeyBase58: bs58.encode(Buffer.concat([decoded.seed, decoded.publicKey])) };
}

function isStoredWallet(value: unknown): value is StoredLocalWallet {
  return typeof value === "object" && value != null
    && typeof (value as StoredLocalWallet).name === "string"
    && typeof (value as StoredLocalWallet).address === "string"
    && typeof (value as StoredLocalWallet).secret === "string";
}

/**
 * On-device Solana wallet generator. Secrets are encrypted with the OS
 * keychain (Electron safeStorage) and never persisted in plaintext; the
 * plaintext secret only exists long enough to hand it to the renderer on an
 * explicit reveal.
 */
export function createLocalSolanaWalletStore(deps: LocalSolanaWalletStoreDeps) {
  const randomSeed = deps.randomSeed ?? (() => randomBytes(32));
  const now = deps.now ?? (() => new Date());

  const load = async (): Promise<StoredLocalWallet[]> => {
    let raw: string;
    try { raw = await fs.readFile(deps.storePath, "utf8"); }
    catch { return []; }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed == null || !Array.isArray((parsed as { wallets?: unknown }).wallets)) return [];
      return (parsed as { wallets: unknown[] }).wallets.filter(isStoredWallet);
    } catch { return []; }
  };

  const persist = async (wallets: readonly StoredLocalWallet[]): Promise<void> => {
    await fs.mkdir(dirname(deps.storePath), { recursive: true });
    const temporary = `${deps.storePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ version: 1, wallets }, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, deps.storePath);
  };

  return {
    async generateLocalWallet(raw: unknown): Promise<LocalSolanaWalletRecord> {
      const name = normalizeWalletName(typeof raw === "object" && raw != null ? (raw as { name?: unknown }).name : undefined);
      if (name.length === 0) throw new Error("A wallet needs a name of 1-120 characters.");
      if (!deps.safeStorage.isEncryptionAvailable()) throw new SolanaSecureStorageUnavailableError();
      const existing = await load();
      if (existing.some(wallet => wallet.name === name)) throw new SolanaWalletNameTakenError();
      const seed = randomSeed();
      const { address, secretKeyBase58 } = solanaKeypairFromSeed(seed);
      const record: StoredLocalWallet = { name, address, createdAt: now().toISOString(), secret: deps.safeStorage.encryptString(secretKeyBase58).toString("base64") };
      await persist([record, ...existing]);
      return { name, address, createdAt: record.createdAt };
    },

    async listLocalWallets(): Promise<{ wallets: readonly LocalSolanaWalletRecord[] }> {
      const wallets = await load();
      return { wallets: wallets.map(({ name, address, createdAt }) => ({ name, address, createdAt })) };
    },

    async revealLocalWalletSecret(raw: unknown): Promise<string> {
      const name = normalizeWalletName(typeof raw === "object" && raw != null ? (raw as { name?: unknown }).name : undefined);
      const wallet = (await load()).find(entry => entry.name === name);
      if (wallet == null) throw new Error(`No local wallet named "${name}".`);
      if (!deps.safeStorage.isEncryptionAvailable()) throw new SolanaSecureStorageUnavailableError();
      return deps.safeStorage.decryptString(Buffer.from(wallet.secret, "base64"));
    },
  };
}

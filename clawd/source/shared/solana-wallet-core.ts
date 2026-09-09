import { createPrivateKey, createPublicKey } from "node:crypto";
import bs58 from "bs58";

/**
 * TypeScript port of Trust Wallet Core's Solana Address and Entry
 * (`wallet-core/src/Solana/Address.{h,cpp}` and `Entry.{h,cpp}`).
 * Address size is 32 bytes (Ed25519 public key), encoded as Base58.
 */
export const SOLANA_ADDRESS_SIZE = 32;
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function decodeSolanaBase58(value: string): Buffer | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return Buffer.from(bs58.decode(value));
  } catch {
    return null;
  }
}

/** Address::isValid(const std::string&) — Base58 payload must be exactly 32 bytes. */
export function isValidSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const data = decodeSolanaBase58(value);
  return data != null && data.length === SOLANA_ADDRESS_SIZE;
}

/** Address::string() / Address(const Data&) — Base58 of a 32-byte Ed25519 public key. */
export function encodeSolanaAddress(publicKey: Buffer | Uint8Array): string {
  if (publicKey.length !== SOLANA_ADDRESS_SIZE) throw new Error("Invalid public key data size");
  return bs58.encode(Buffer.from(publicKey));
}

function ed25519PublicKeyFromSeed(seed: Buffer): Buffer {
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKeyDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return Buffer.from(publicKeyDer).subarray(-SOLANA_ADDRESS_SIZE);
}

function parseHexPrivateKey(privateKey: string): Buffer {
  const hex = privateKey.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("Invalid private key");
  return Buffer.from(hex, "hex");
}

/**
 * Entry::decodePrivateKey — Base58 64-byte (seed||public) with public-key check,
 * Base58 32-byte seed, or hex seed. Matches Trust Wallet Core Solana Entry.cpp.
 */
export function decodeSolanaPrivateKey(privateKey: string): { seed: Buffer; publicKey: Buffer; address: string } {
  if (typeof privateKey !== "string" || privateKey.trim().length === 0) throw new Error("Invalid private key");
  const trimmed = privateKey.trim();
  const base58 = decodeSolanaBase58(trimmed);
  let seed: Buffer;
  let expectedPublic: Buffer | null = null;
  if (base58 != null && base58.length === 64) {
    seed = Buffer.from(base58.subarray(0, 32));
    expectedPublic = Buffer.from(base58.subarray(32, 64));
  } else if (base58 != null && base58.length === 32) {
    seed = base58;
  } else {
    const hex = parseHexPrivateKey(trimmed);
    if (hex.length === 64) {
      seed = Buffer.from(hex.subarray(0, 32));
      expectedPublic = Buffer.from(hex.subarray(32, 64));
    } else if (hex.length === 32) {
      seed = hex;
    } else {
      throw new Error("Invalid private key");
    }
  }
  const publicKey = ed25519PublicKeyFromSeed(seed);
  if (expectedPublic != null && !expectedPublic.equals(publicKey)) throw new Error("Invalid private key");
  return { seed, publicKey, address: encodeSolanaAddress(publicKey) };
}

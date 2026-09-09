import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import bs58 from "bs58";

/**
 * Minimal Solana versioned-transaction signing. Jupiter's /swap endpoint
 * returns an unsigned v0 transaction; we sign it with a local wallet secret
 * (64-byte base58: 32-byte seed + 32-byte public key) using node:crypto's
 * Ed25519 — no @solana/web3.js dependency required.
 */

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export interface ParsedVersionedTransaction {
  readonly signatureCount: number;
  readonly message: Buffer;
  readonly numRequiredSignatures: number;
  readonly firstAccountKey: string;
}

/** Reads a little-endian base-128 (compact-u16) varint at offset. */
export function readCompactU16(buffer: Buffer, offset: number): { value: number; bytesUsed: number } {
  let value = 0;
  let shift = 0;
  let index = offset;
  for (;;) {
    if (index >= buffer.length) throw new Error("Truncated compact-u16 in transaction.");
    const byte = buffer[index]!;
    value |= (byte & 0x7f) << shift;
    index += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 21) throw new Error("compact-u16 value exceeds 3 bytes.");
  }
  return { value, bytesUsed: index - offset };
}

export function parseVersionedTransaction(base64: string): ParsedVersionedTransaction {
  const raw = Buffer.from(base64, "base64");
  if (raw.length < 3) throw new Error("Transaction bytes are too short to be a Solana transaction.");
  const { value: signatureCount, bytesUsed } = readCompactU16(raw, 0);
  if (signatureCount < 1 || signatureCount > 16) throw new Error(`Unreasonable signature count: ${signatureCount}.`);
  const signaturesStart = bytesUsed;
  const signaturesEnd = signaturesStart + signatureCount * 64;
  if (raw.length <= signaturesEnd) throw new Error("Transaction is truncated before its message bytes.");
  const message = raw.subarray(signaturesEnd);
  if (message.length < 4 + 32) throw new Error("Transaction message is too short.");
  const versioned = (message[0]! & 0x80) !== 0;
  let numRequiredSignatures: number;
  let accountKeysOffset: number;
  if (versioned) {
    const version = message[0]! & 0x7f;
    if (version !== 0) throw new Error(`Unsupported Solana transaction version ${version}.`);
    if (message.length < 5 + 32) throw new Error("Versioned transaction message is too short.");
    numRequiredSignatures = message[1]!;
    accountKeysOffset = 4;
  } else {
    numRequiredSignatures = message[0]!;
    accountKeysOffset = 3;
  }
  if (numRequiredSignatures !== signatureCount) {
    throw new Error(`Transaction declares ${signatureCount} signature slots but requires ${numRequiredSignatures}.`);
  }
  const { value: accountKeyCount, bytesUsed: accountKeyBytesUsed } = readCompactU16(message, accountKeysOffset);
  if (accountKeyCount < numRequiredSignatures) throw new Error("Transaction has fewer account keys than required signatures.");
  const keysStart = accountKeysOffset + accountKeyBytesUsed;
  if (message.length < keysStart + accountKeyCount * 32) throw new Error("Transaction account keys are truncated.");
  const firstAccountKey = bs58.encode(message.subarray(keysStart, keysStart + 32));
  return { signatureCount, message, numRequiredSignatures, firstAccountKey };
}

export function keypairFromSecret(secretKeyBase58: string): { publicKey: string; sign: (message: Buffer) => Buffer } {
  const secret = bs58.decode(secretKeyBase58.trim());
  if (secret.length !== 64) throw new Error("A Solana wallet secret must decode to exactly 64 bytes.");
  const seed = secret.subarray(0, 32);
  const expectedPublicKey = secret.subarray(32, 64);
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKeyDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const publicKeyBytes = Buffer.from(publicKeyDer).subarray(-32);
  if (!publicKeyBytes.equals(expectedPublicKey)) throw new Error("The wallet secret's embedded public key does not match its Ed25519 seed.");
  return {
    publicKey: bs58.encode(publicKeyBytes),
    sign: (message: Buffer): Buffer => cryptoSign(null, message, privateKey),
  };
}

/**
 * Signs an unsigned (or single-signature-slot) v0 transaction as the payer.
 * The signer must be the transaction's first account key; the original
 * message bytes are preserved byte-for-byte.
 */
export function signVersionedTransaction(base64: string, secretKeyBase58: string): { signedTransaction: string; signer: string } {
  const parsed = parseVersionedTransaction(base64);
  if (parsed.numRequiredSignatures !== 1 || parsed.signatureCount !== 1) {
    throw new Error(`Only single-signer transactions are supported (this one requires ${parsed.numRequiredSignatures}).`);
  }
  const keypair = keypairFromSecret(secretKeyBase58);
  if (parsed.firstAccountKey !== keypair.publicKey) {
    throw new Error(`This transaction's fee payer is ${parsed.firstAccountKey}, but the selected wallet is ${keypair.publicKey}.`);
  }
  const signature = keypair.sign(parsed.message);
  const signed = Buffer.concat([Buffer.from([0x01]), signature, parsed.message]);
  return { signedTransaction: signed.toString("base64"), signer: keypair.publicKey };
}

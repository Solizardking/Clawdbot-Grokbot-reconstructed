import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SafeStorageCodecPort } from "./local-wallets.ts";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function decodeKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const buf = Buffer.from(trimmed, "base64");
    return buf.length === KEY_BYTES ? buf : null;
  } catch {
    return null;
  }
}

function loadOrCreateKey(keyPath: string, envKey: string | undefined): Buffer {
  const fromEnv = envKey ? decodeKey(envKey) : null;
  if (fromEnv) return fromEnv;
  try {
    const existing = readFileSync(keyPath);
    if (existing.length === KEY_BYTES) return existing;
  } catch {
    /* first run */
  }
  const generated = randomBytes(KEY_BYTES);
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, generated, { mode: 0o600 });
  return generated;
}

/** AES-256-GCM codec keyed by Electron-injected env or a 0600 file in the data dir. */
export function createAesGcmSafeStorage(options: { keyPath: string; envKey?: string }): SafeStorageCodecPort {
  const key = loadOrCreateKey(options.keyPath, options.envKey);
  return {
    isEncryptionAvailable() {
      return key.length === KEY_BYTES;
    },
    encryptString(plainText: string): Buffer {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]);
    },
    decryptString(encrypted: Buffer): string {
      if (encrypted.length < IV_BYTES + AUTH_TAG_BYTES) throw new Error("Sealed wallet secret is truncated.");
      const iv = encrypted.subarray(0, IV_BYTES);
      const tag = encrypted.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
      const data = encrypted.subarray(IV_BYTES + AUTH_TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
  };
}

export function sealKeyFileExists(keyPath: string): boolean {
  return existsSync(keyPath);
}

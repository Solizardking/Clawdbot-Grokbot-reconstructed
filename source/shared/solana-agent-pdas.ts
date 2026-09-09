import { createHash } from "node:crypto";
import bs58 from "bs58";

import { isValidSolanaAddress } from "./solana-wallet-core.js";

/** MPL Agent Identity program — same address on mainnet and devnet. */
export const MPL_AGENT_IDENTITY_PROGRAM_ID = "1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p";
/** MPL Agent Tools program (executive profiles + execution delegates). */
export const MPL_AGENT_TOOLS_PROGRAM_ID = "TLREGni9ZEyGC3vnPZtqUh95xQ8oPqJSvNjvB7FGK8S";
/** MPL Core program. */
export const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

export const METAPLEX_API_BASE = "https://api.metaplex.com";
export const AGENT_REGISTRY_LABEL = "solana:101:metaplex";

const PDA_MARKER = Buffer.from("ProgramDerivedAddress");
const ED25519_P = (1n << 255n) - 19n;
/** d = -121665/121666 mod p */
const ED25519_D = 37095705934669439343138088257585976786914408881273679613222689040768653137800n;

export interface ProgramAddress {
  readonly address: string;
  readonly bump: number;
}

function requireAddress(value: string, label: string): Buffer {
  if (!isValidSolanaAddress(value)) throw new Error(`${label} must be a valid base58 Solana address.`);
  return Buffer.from(bs58.decode(value));
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** True when the 32-byte value is a valid compressed Ed25519 point (on the curve). */
export function isEd25519OnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 0; i < 32; i++) y |= BigInt(bytes[i]!) << BigInt(8 * i);
  const sign = y >> 255n;
  y &= (1n << 255n) - 1n;
  if (y >= ED25519_P) return false;
  const y2 = (y * y) % ED25519_P;
  const u = (y2 - 1n + ED25519_P) % ED25519_P;
  const v = (ED25519_D * y2 + 1n) % ED25519_P;
  const x2 = (u * modPow(v, ED25519_P - 2n, ED25519_P)) % ED25519_P;
  if (x2 === 0n) return sign === 0n;
  return modPow(x2, (ED25519_P - 1n) / 2n, ED25519_P) === 1n;
}

export function findProgramAddress(seeds: readonly Buffer[], programId: string): ProgramAddress {
  const program = requireAddress(programId, "programId");
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash("sha256");
    for (const seed of seeds) hash.update(seed);
    hash.update(Buffer.from([bump]));
    hash.update(program);
    hash.update(PDA_MARKER);
    const digest = hash.digest();
    if (!isEd25519OnCurve(digest)) return { address: bs58.encode(digest), bump };
  }
  throw new Error("Unable to find a viable program address bump.");
}

export function findAgentIdentityV1Pda(asset: string): ProgramAddress {
  return findProgramAddress(
    [Buffer.from("agent_identity"), requireAddress(asset, "asset")],
    MPL_AGENT_IDENTITY_PROGRAM_ID,
  );
}

export function findExecutiveProfileV1Pda(authority: string): ProgramAddress {
  return findProgramAddress(
    [Buffer.from("executive_profile"), requireAddress(authority, "authority")],
    MPL_AGENT_TOOLS_PROGRAM_ID,
  );
}

export function findExecutionDelegateRecordV1Pda(executiveProfile: string, agentAsset: string): ProgramAddress {
  return findProgramAddress(
    [
      Buffer.from("execution_delegate_record"),
      requireAddress(executiveProfile, "executiveProfile"),
      requireAddress(agentAsset, "agentAsset"),
    ],
    MPL_AGENT_TOOLS_PROGRAM_ID,
  );
}

/** Core Execute PDA — the agent's on-chain wallet. */
export function findAssetSignerPda(asset: string): ProgramAddress {
  return findProgramAddress(
    [Buffer.from("mpl-core-execute"), requireAddress(asset, "asset")],
    MPL_CORE_PROGRAM_ID,
  );
}

export function erc8004RegistrationDocument(input: {
  readonly name: string;
  readonly description: string;
  readonly image: string;
  readonly assetAddress?: string;
  readonly services?: ReadonlyArray<{ readonly name: string; readonly endpoint: string; readonly version?: string }>;
}): Record<string, unknown> {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: input.name,
    description: input.description,
    image: input.image,
    services: input.services ?? [],
    active: true,
    registrations: input.assetAddress == null ? [] : [{ agentId: input.assetAddress, agentRegistry: AGENT_REGISTRY_LABEL }],
    supportedTrust: ["reputation"],
  };
}

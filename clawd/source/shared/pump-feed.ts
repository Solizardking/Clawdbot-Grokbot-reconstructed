import { isValidSolanaAddress } from "./solana-wallet-core.js";

export type PumpTokenLaunch = {
  type: "token-launch";
  signature: string;
  time: string;
  name: string | null;
  symbol: string | null;
  mint: string | null;
  creator: string | null;
  isV2: boolean;
  metadataUri: string | null;
  imageUri: string | null;
  description: string | null;
  marketCapSol: number | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  hasGithub: boolean;
  githubUrls: string[];
};

export type PumpServerStatus = {
  type: "status";
  connected: boolean;
  uptime: number;
  totalLaunches: number;
  githubLaunches: number;
  clients: number;
};

export type PumpTokenEnriched = {
  type: "token-enriched";
  mint: string;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  logoUri: string | null;
  ts: number;
};

export type PumpMessage = PumpTokenLaunch | PumpServerStatus | PumpTokenEnriched;

export function parsePumpMessage(raw: string): PumpMessage | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== "object" || parsed == null) return null;
  const type = (parsed as { type?: unknown }).type;
  const row = parsed as Record<string, unknown>;
  if (type === "status" && typeof row.connected === "boolean") return parsed as PumpServerStatus;
  if (type === "token-enriched" && isValidSolanaAddress(row.mint)) return parsed as PumpTokenEnriched;
  if (type === "token-launch" && typeof row.signature === "string" && row.signature.length > 0 && row.signature.length <= 128 && isValidSolanaAddress(row.mint)) {
    for (const key of ["name", "symbol", "time", "description", "creator", "metadataUri", "imageUri", "website", "twitter", "telegram"]) if (row[key] != null && typeof row[key] !== "string") return null;
    row.hasGithub = row.hasGithub === true;
    row.githubUrls = Array.isArray(row.githubUrls) ? row.githubUrls.filter(x => typeof x === "string").slice(0, 10) : [];
    return parsed as PumpTokenLaunch;
  }
  return null;
}

export interface PumpTapeStore {
  apply(message: PumpMessage): void;
  recent(options?: { limit?: number; githubOnly?: boolean }): PumpTokenLaunch[];
  search(query: string, limit?: number): PumpTokenLaunch[];
  enrichments(mints: readonly string[]): Record<string, PumpTokenEnriched>;
  snapshot(): { connectedToRelay: boolean; bufferedLaunches: number; trackedEnrichments: number; relayStatus: PumpServerStatus | null; lastEventAtMs: number | null };
}

export function createPumpTapeStore(options?: { readonly now?: () => number; readonly maxLaunches?: number; readonly maxEnrichments?: number }): PumpTapeStore {
  const now = options?.now ?? Date.now;
  const maxLaunches = options?.maxLaunches ?? 120;
  const maxEnrichments = options?.maxEnrichments ?? 600;
  const launches: PumpTokenLaunch[] = [];
  const enriched = new Map<string, PumpTokenEnriched>();
  let relayStatus: PumpServerStatus | null = null;
  let lastEventAtMs: number | null = null;
  return {
    apply(message: PumpMessage): void {
      lastEventAtMs = now();
      if (message.type === "status") { relayStatus = message; return; }
      if (message.type === "token-enriched") {
        enriched.set(message.mint, message);
        if (enriched.size > maxEnrichments) {
          for (const key of enriched.keys()) { enriched.delete(key); if (enriched.size <= maxEnrichments) break; }
        }
        return;
      }
      if (launches.some(existing => existing.signature === message.signature)) return;
      launches.unshift(message);
      if (launches.length > maxLaunches) launches.length = maxLaunches;
    },
    recent(options?: { limit?: number; githubOnly?: boolean }): PumpTokenLaunch[] {
      const limit = clampLimit(options?.limit);
      const pool = options?.githubOnly === true ? launches.filter(launch => launch.hasGithub) : launches;
      return pool.slice(0, limit);
    },
    search(query: string, limit?: number): PumpTokenLaunch[] {
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) return [];
      const bounded = clampLimit(limit);
      return launches.filter(launch => [launch.name, launch.symbol, launch.mint, launch.description].some(field => typeof field === "string" && field.toLowerCase().includes(needle))).slice(0, bounded);
    },
    enrichments(mints: readonly string[]): Record<string, PumpTokenEnriched> {
      const result: Record<string, PumpTokenEnriched> = {};
      for (const mint of mints.slice(0, 10)) {
        const row = typeof mint === "string" ? enriched.get(mint.trim()) : undefined;
        if (row != null) result[row.mint] = row;
      }
      return result;
    },
    snapshot() {
      return { connectedToRelay: relayStatus?.connected === true, bufferedLaunches: launches.length, trackedEnrichments: enriched.size, relayStatus, lastEventAtMs };
    },
  };
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.floor(value)));
}


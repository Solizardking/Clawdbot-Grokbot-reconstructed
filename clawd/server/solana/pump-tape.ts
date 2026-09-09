import type { RoutedToolDefinition } from "./solana-routed-tools.ts";

export const DEFAULT_PUMP_WS_URL = "wss://clawd-ws.fly.dev/ws";
export const DEFAULT_PUMP_HTTP_URL = "https://clawd-ws.fly.dev";

export type PumpLaunchMessage = {
  type: "token-launch";
  signature?: string;
  name?: string;
  symbol?: string;
  mint?: string | null;
  creator?: string | null;
  time?: number | null;
  marketCapSol?: number | null;
  description?: string | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  hasGithub?: boolean;
  githubUrls?: string[];
  imageUri?: string | null;
};
export type PumpStatusMessage = { type: "status"; connected?: boolean; [key: string]: unknown };
export type PumpEnrichedMessage = { type: "token-enriched"; mint: string; [key: string]: unknown };
export type PumpMessage = PumpLaunchMessage | PumpStatusMessage | PumpEnrichedMessage;

export function pumpRelayWsUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.SAND_PUMP_WS_URL?.trim() || env.OMB_PUMP_WS_URL?.trim() || DEFAULT_PUMP_WS_URL;
}

export function pumpRelayHttpUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SAND_PUMP_HTTP_URL?.trim() || env.OMB_PUMP_HTTP_URL?.trim() || DEFAULT_PUMP_HTTP_URL).replace(/\/$/, "");
}

export function parsePumpMessage(raw: string): PumpMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed == null) return null;
  const type = (parsed as Record<string, unknown>).type;
  if (type === "token-launch" || type === "status" || type === "token-enriched") return parsed as PumpMessage;
  return null;
}

export function createPumpTapeStore(options?: { now?: () => number; maxLaunches?: number; maxEnrichments?: number }) {
  const now = options?.now ?? Date.now;
  const maxLaunches = options?.maxLaunches ?? 120;
  const maxEnrichments = options?.maxEnrichments ?? 600;
  const launches: PumpLaunchMessage[] = [];
  const enriched = new Map<string, PumpEnrichedMessage>();
  let relayStatus: PumpStatusMessage | null = null;
  let lastEventAtMs: number | null = null;

  return {
    apply(message: PumpMessage): void {
      lastEventAtMs = now();
      if (message.type === "status") {
        relayStatus = message;
        return;
      }
      if (message.type === "token-enriched") {
        enriched.set(message.mint, message);
        if (enriched.size > maxEnrichments) {
          for (const key of enriched.keys()) {
            enriched.delete(key);
            if (enriched.size <= maxEnrichments) break;
          }
        }
        return;
      }
      if (launches.some((existing) => existing.signature === message.signature)) return;
      launches.unshift(message);
      if (launches.length > maxLaunches) launches.length = maxLaunches;
    },
    recent(options?: { limit?: number; githubOnly?: boolean }): PumpLaunchMessage[] {
      const limit = clampLimit(options?.limit);
      const pool = options?.githubOnly === true ? launches.filter((launch) => launch.hasGithub) : launches;
      return pool.slice(0, limit);
    },
    search(query: string, limit: number): PumpLaunchMessage[] {
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) return [];
      const bounded = clampLimit(limit);
      return launches
        .filter((launch) =>
          [launch.name, launch.symbol, launch.mint, launch.description].some(
            (field) => typeof field === "string" && field.toLowerCase().includes(needle),
          ),
        )
        .slice(0, bounded);
    },
    enrichments(mints: readonly unknown[]): Record<string, PumpEnrichedMessage> {
      const result: Record<string, PumpEnrichedMessage> = {};
      for (const mint of mints.slice(0, 10)) {
        const row = typeof mint === "string" ? enriched.get(mint.trim()) : undefined;
        if (row != null) result[row.mint] = row;
      }
      return result;
    },
    snapshot() {
      return {
        connectedToRelay: relayStatus?.connected === true,
        bufferedLaunches: launches.length,
        trackedEnrichments: enriched.size,
        relayStatus,
        lastEventAtMs,
      };
    },
  };
}

export type PumpTapeStore = ReturnType<typeof createPumpTapeStore>;

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

type ReadySocket = {
  on(event: "message", listener: (raw: unknown) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: () => void): void;
  close(): void;
  unref?(): void;
};

function wrapBrowserSocket(socket: WebSocket): ReadySocket {
  const listeners = {
    message: new Set<(raw: unknown) => void>(),
    close: new Set<() => void>(),
    error: new Set<() => void>(),
  };
  socket.addEventListener("message", (event) => {
    for (const listener of listeners.message) listener(event.data);
  });
  socket.addEventListener("close", () => {
    for (const listener of listeners.close) listener();
  });
  socket.addEventListener("error", () => {
    for (const listener of listeners.error) listener();
  });
  return {
    on(event, listener) {
      if (event === "message") listeners.message.add(listener as (raw: unknown) => void);
      else if (event === "close") listeners.close.add(listener as () => void);
      else listeners.error.add(listener as () => void);
    },
    close() {
      socket.close();
    },
  };
}

const defaultSocketOpener = async (url: string): Promise<ReadySocket> => wrapBrowserSocket(new WebSocket(url));

export interface PumpTapeRelay {
  readonly store: PumpTapeStore;
  ensureStarted(): void;
  stop(): void;
}

export function startPumpTapeRelay(
  store: PumpTapeStore,
  options?: { url?: string; open?: (url: string) => Promise<ReadySocket> | ReadySocket },
): PumpTapeRelay {
  const url = options?.url?.trim() || pumpRelayWsUrl();
  const open = options?.open ?? defaultSocketOpener;
  let socket: ReadySocket | null = null;
  let stopped = false;
  let reconnectDelayMs = 1_000;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer != null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
    reconnectTimer.unref?.();
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  };

  const connect = () => {
    if (stopped || socket != null) return;
    let candidate: Promise<ReadySocket> | ReadySocket;
    try {
      candidate = open(url);
    } catch {
      scheduleReconnect();
      return;
    }
    Promise.resolve(candidate).then(
      (ready) => {
        if (stopped) {
          ready.close();
          return;
        }
        if (socket != null) {
          ready.close();
          return;
        }
        socket = ready;
        reconnectDelayMs = 1_000;
        ready.on("message", (raw) => {
          const message = parsePumpMessage(typeof raw === "string" ? raw : String(Buffer.isBuffer(raw) ? raw : raw));
          if (message != null) store.apply(message);
        });
        ready.on("close", () => {
          if (socket === ready) socket = null;
          scheduleReconnect();
        });
        ready.on("error", () => {
          if (socket === ready) {
            socket = null;
            try {
              ready.close();
            } catch {
              /* ignore */
            }
          }
          scheduleReconnect();
        });
        ready.unref?.();
      },
      () => scheduleReconnect(),
    );
  };

  return {
    store,
    ensureStarted: connect,
    stop() {
      stopped = true;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = socket;
      socket = null;
      try {
        current?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

const PUMP_TOOL_PROVIDER = "clawdbot-local-pump";

export function launchSummary(launch: PumpLaunchMessage, tape: PumpTapeStore) {
  return {
    name: launch.name,
    symbol: launch.symbol,
    mint: launch.mint,
    creator: launch.creator,
    time: launch.time,
    marketCapSol: launch.marketCapSol,
    description: launch.description,
    website: launch.website,
    twitter: launch.twitter,
    telegram: launch.telegram,
    hasGithub: launch.hasGithub,
    githubUrls: launch.githubUrls,
    imageUri: launch.imageUri,
    pumpFunUrl: launch.mint == null ? null : `https://pump.fun/coin/${launch.mint}`,
    ...(launch.mint == null ? {} : { enrichment: tape.enrichments([launch.mint])[launch.mint] ?? null }),
  };
}

const PUMP_LAUNCHES_SCHEMA = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "How many recent launches to return." },
    github_only: { type: "boolean", default: false, description: "Only launches that include a GitHub repository link." },
  },
  additionalProperties: false,
};

const PUMP_SEARCH_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, description: "Substring matched against token name, symbol, mint, or description." },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
  },
  required: ["query"],
  additionalProperties: false,
};

const PUMP_ENRICHMENT_SCHEMA = {
  type: "object",
  properties: {
    mints: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10, description: "Solana mint addresses seen on the live tape." },
  },
  required: ["mints"],
  additionalProperties: false,
};

const PUMP_STATUS_SCHEMA = { type: "object", properties: {}, additionalProperties: false };

export const PUMP_ROUTED_TOOLS: readonly RoutedToolDefinition[] = [
  {
    name: "pump_recent_launches",
    toolName: "pump_recent_launches",
    providerIdentifier: PUMP_TOOL_PROVIDER,
    description:
      "List the newest live pump.fun token launches from the same WebSocket tape that powers solgpt.us/pump (Helius webhooks + Birdeye/Solana Tracker enrichment). Use whenever the user asks about brand-new Solana token launches.",
    inputSchema: PUMP_LAUNCHES_SCHEMA,
  },
  {
    name: "pump_search_launches",
    toolName: "pump_search_launches",
    providerIdentifier: PUMP_TOOL_PROVIDER,
    description: "Search the live pump.fun launch tape buffer for tokens whose name, symbol, mint, or description contains the query. Read-only.",
    inputSchema: PUMP_SEARCH_SCHEMA,
  },
  {
    name: "pump_token_enrichment",
    toolName: "pump_token_enrichment",
    providerIdentifier: PUMP_TOOL_PROVIDER,
    description: "Get latest price, market cap, liquidity, holders, and 24h change for up to 10 pump.fun mints observed on the live tape. Read-only lookup.",
    inputSchema: PUMP_ENRICHMENT_SCHEMA,
  },
  {
    name: "pump_relay_status",
    toolName: "pump_relay_status",
    providerIdentifier: PUMP_TOOL_PROVIDER,
    description: "Fetch the health and counters of the live pump.fun relay feed (uptime, total launches, connected clients). Read-only diagnostics.",
    inputSchema: PUMP_STATUS_SCHEMA,
  },
];

export function pumpRoutedTools(): readonly RoutedToolDefinition[] {
  ensurePumpTape();
  return PUMP_ROUTED_TOOLS;
}

export function isPumpRoutedTool(name: unknown): name is string {
  return typeof name === "string" && PUMP_ROUTED_TOOLS.some((tool) => tool.name === name);
}

type FetchLike = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

async function fetchRelayHealth(env: NodeJS.ProcessEnv, fetchImpl: FetchLike): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${pumpRelayHttpUrl(env)}/health`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return { ok: false, status: response.status };
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function clampToolLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

export async function executePumpRoutedTool(
  name: string,
  args: unknown,
  options?: { store?: PumpTapeStore; env?: NodeJS.ProcessEnv; fetchImpl?: FetchLike },
) {
  const env = options?.env ?? process.env;
  const tape = options?.store ?? ensurePumpTape().store;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const record = typeof args === "object" && args != null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  switch (name) {
    case "pump_recent_launches": {
      const limit = clampToolLimit(record.limit);
      const launches = tape.recent({ limit, githubOnly: record.github_only === true });
      return { ok: true, count: launches.length, relayUrl: pumpRelayWsUrl(env), launches: launches.map((launch) => launchSummary(launch, tape)) };
    }
    case "pump_search_launches": {
      const query = typeof record.query === "string" ? record.query : "";
      if (query.trim().length === 0) throw new Error("pump_search_launches requires a non-empty query.");
      const launches = tape.search(query, clampToolLimit(record.limit ?? 10));
      return { ok: true, query, count: launches.length, launches: launches.map((launch) => launchSummary(launch, tape)) };
    }
    case "pump_token_enrichment": {
      const mints = Array.isArray(record.mints) ? record.mints.filter((mint): mint is string => typeof mint === "string") : [];
      if (mints.length === 0) throw new Error("pump_token_enrichment requires at least one mint address.");
      return { ok: true, found: tape.enrichments(mints), requested: mints.length };
    }
    case "pump_relay_status":
      return { ok: true, local: tape.snapshot(), health: await fetchRelayHealth(env, fetchImpl), relayHttpUrl: pumpRelayHttpUrl(env) };
    default:
      throw new Error(`Unknown pump tape tool: ${name}`);
  }
}

let sharedRelay: PumpTapeRelay | null = null;

export function ensurePumpTape(options?: { url?: string; open?: (url: string) => Promise<ReadySocket> | ReadySocket }): PumpTapeRelay {
  if (sharedRelay == null) sharedRelay = startPumpTapeRelay(createPumpTapeStore(), options);
  sharedRelay.ensureStarted();
  return sharedRelay;
}

/** Test-only: drop the shared relay so a later ensurePumpTape starts fresh. */
export function resetPumpTapeForTests(): void {
  sharedRelay?.stop();
  sharedRelay = null;
}

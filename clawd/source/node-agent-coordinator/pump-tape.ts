import { createPumpTapeStore, parsePumpMessage, type PumpTapeStore, type PumpTokenLaunch } from "../shared/pump-feed.js";
export * from "../shared/pump-feed.js";

const DEFAULT_PUMP_WS_URL = "wss://clawd-ws.fly.dev/ws";
const DEFAULT_PUMP_HTTP_URL = "https://clawd-ws.fly.dev";

export function pumpRelayWsUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.SAND_PUMP_WS_URL?.trim() || DEFAULT_PUMP_WS_URL;
}

export function pumpRelayHttpUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SAND_PUMP_HTTP_URL?.trim() || DEFAULT_PUMP_HTTP_URL).replace(/\/$/, "");
}

export interface PumpSocketLike {
  on(event: "open" | "message" | "close" | "error", listener: (...args: unknown[]) => void): unknown;
  close(): unknown;
  unref?(): unknown;
}

export type PumpSocketOpener = (url: string) => Promise<PumpSocketLike> | PumpSocketLike;

const defaultSocketOpener: PumpSocketOpener = async url => {
  const mod = await import("ws") as unknown as { WebSocket?: new (url: string) => PumpSocketLike; default?: new (url: string) => PumpSocketLike };
  const Ctor = mod.WebSocket ?? mod.default;
  if (Ctor == null) throw new Error("The ws module did not provide a WebSocket constructor.");
  return new Ctor(url);
};

export interface PumpTapeRelay {
  readonly store: PumpTapeStore;
  ensureStarted(): void;
  stop(): void;
}

export function startPumpTapeRelay(store: PumpTapeStore, options?: { readonly url?: string; readonly open?: PumpSocketOpener }): PumpTapeRelay {
  const url = options?.url?.trim() || pumpRelayWsUrl();
  const open = options?.open ?? defaultSocketOpener;
  let socket: PumpSocketLike | null = null;
  let stopped = false;
  let reconnectDelayMs = 1_000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleReconnect = () => {
    if (stopped || reconnectTimer != null) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, reconnectDelayMs);
    reconnectTimer.unref?.();
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  };
  const connect = () => {
    if (stopped || socket != null) return;
    let candidate: PumpSocketLike;
    try { candidate = open(url) as PumpSocketLike; }
    catch { scheduleReconnect(); return; }
    Promise.resolve(candidate).then(ready => {
      if (stopped) { ready.close(); return; }
      if (socket != null) { ready.close(); return; }
      socket = ready;
      reconnectDelayMs = 1_000;
      ready.on("message", raw => {
        const message = parsePumpMessage(typeof raw === "string" ? raw : String(Buffer.isBuffer(raw) ? raw : raw));
        if (message != null) store.apply(message);
      });
      ready.on("close", () => { if (socket === ready) socket = null; scheduleReconnect(); });
      ready.on("error", () => { if (socket === ready) { socket = null; try { ready.close(); } catch {} } scheduleReconnect(); });
      ready.unref?.();
    }, () => scheduleReconnect());
  };
  return {
    store,
    ensureStarted: connect,
    stop() {
      stopped = true;
      if (reconnectTimer != null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      const current = socket;
      socket = null;
      try { current?.close(); } catch {}
    },
  };
}

const PUMP_TOOL_PROVIDER = "grok-bot-local-pump";

export type PumpRoutedTool = {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

const launchSummary = (launch: PumpTokenLaunch, tape: PumpTapeStore) => ({
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
});

const PUMP_LAUNCHES_SCHEMA = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "How many recent launches to return." },
    github_only: { type: "boolean", default: false, description: "Only launches that include a GitHub repository link." },
  },
  additionalProperties: false,
} as const;

const PUMP_SEARCH_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, description: "Substring matched against token name, symbol, mint, or description." },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const PUMP_ENRICHMENT_SCHEMA = {
  type: "object",
  properties: {
    mints: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10, description: "Solana mint addresses seen on the live tape." },
  },
  required: ["mints"],
  additionalProperties: false,
} as const;

const PUMP_STATUS_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

export const PUMP_ROUTED_TOOLS: readonly PumpRoutedTool[] = [
  {
    name: "pump_recent_launches",
    toolName: "pump_recent_launches",
    providerIdentifier: PUMP_TOOL_PROVIDER,
    description: "List the newest live pump.fun token launches from the same WebSocket tape that powers solgpt.us/pump (Helius webhooks + Birdeye/Solana Tracker enrichment). Use whenever the user asks about brand-new Solana token launches.",
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

export function pumpRoutedTools(): readonly PumpRoutedTool[] {
  ensurePumpTape();
  return PUMP_ROUTED_TOOLS;
}

export function isPumpRoutedTool(name: unknown): boolean {
  return typeof name === "string" && PUMP_ROUTED_TOOLS.some(tool => tool.name === name);
}

async function fetchRelayHealth(): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref?.();
  try {
    const response = await fetch(`${pumpRelayHttpUrl()}/health`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return { ok: false, status: response.status };
    return await response.json() as unknown;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timeout); }
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

export async function executePumpRoutedTool(name: string, args: unknown): Promise<unknown> {
  const tape = ensurePumpTape().store;
  const record = typeof args === "object" && args != null && !Array.isArray(args) ? args as Record<string, unknown> : {};
  switch (name) {
    case "pump_recent_launches": {
      const limit = clampLimit(typeof record.limit === "number" ? record.limit : undefined);
      const launches = tape.recent({ limit, githubOnly: record.github_only === true });
      return { ok: true, count: launches.length, relayUrl: pumpRelayWsUrl(), launches: launches.map(launch => launchSummary(launch, tape)) };
    }
    case "pump_search_launches": {
      const query = typeof record.query === "string" ? record.query : "";
      if (query.trim().length === 0) throw new Error("pump_search_launches requires a non-empty query.");
      const launches = tape.search(query, clampLimit(typeof record.limit === "number" ? record.limit : 10));
      return { ok: true, query, count: launches.length, launches: launches.map(launch => launchSummary(launch, tape)) };
    }
    case "pump_token_enrichment": {
      const mints = Array.isArray(record.mints) ? record.mints.filter((mint): mint is string => typeof mint === "string") : [];
      if (mints.length === 0) throw new Error("pump_token_enrichment requires at least one mint address.");
      return { ok: true, found: tape.enrichments(mints), requested: mints.length };
    }
    case "pump_relay_status":
      return { ok: true, local: tape.snapshot(), health: await fetchRelayHealth(), relayHttpUrl: pumpRelayHttpUrl() };
    default:
      throw new Error(`Unknown pump tape tool: ${name}`);
  }
}

let sharedRelay: PumpTapeRelay | null = null;

export function ensurePumpTape(options?: { readonly open?: PumpSocketOpener }): PumpTapeRelay {
  if (sharedRelay == null) sharedRelay = startPumpTapeRelay(createPumpTapeStore(), options);
  sharedRelay.ensureStarted();
  return sharedRelay;
}

export function stopPumpTape(): void {
  sharedRelay?.stop();
  sharedRelay = null;
}

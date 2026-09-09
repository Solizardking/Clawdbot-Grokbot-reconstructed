export interface SandOpenRouterLastRoute {
  readonly requestedModel: string | null;
  readonly servedModel: string | null;
  readonly providerName: string | null;
  readonly strategy: string | null;
  readonly attempt: number | null;
  readonly cacheStatus: "HIT" | "MISS" | null;
  readonly recordedAt: string;
}

export const SAND_OPENROUTER_CACHE_DEFAULT_TTL_SECONDS = 300;
export const SAND_OPENROUTER_CACHE_MAX_TTL_SECONDS = 86400;

export function clampOpenRouterCacheTtl(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.floor(value), 1), SAND_OPENROUTER_CACHE_MAX_TTL_SECONDS);
}

export function openRouterCacheHeaders(cacheEnabled: boolean, ttlSeconds?: number): Record<string, string> {
  if (!cacheEnabled) return {};
  const ttl = clampOpenRouterCacheTtl(ttlSeconds);
  return { "X-OpenRouter-Cache": "true", ...(ttl == null || ttl === SAND_OPENROUTER_CACHE_DEFAULT_TTL_SECONDS ? {} : { "X-OpenRouter-Cache-TTL": String(ttl) }) };
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Extracts the router metadata object from a non-streaming JSON body or the final SSE data chunk. */
export function parseOpenRouterMetadataFromText(text: string, contentType: string): Record<string, unknown> | null {
  try {
    if (contentType.includes("text/event-stream")) {
      for (const line of text.split("\n").reverse()) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0 || payload === "[DONE]") continue;
        const parsed = asJsonRecord(JSON.parse(payload));
        const metadata = asJsonRecord(parsed?.openrouter_metadata);
        if (metadata != null) return metadata;
      }
      return null;
    }
    const parsed = asJsonRecord(JSON.parse(text));
    return asJsonRecord(parsed?.openrouter_metadata);
  } catch {
    return null;
  }
}

/** Top-level `model` from a chat-completions JSON body or the last SSE chunk (Auto Router served slug). */
export function parseOpenRouterServedModelFromText(text: string, contentType: string): string | null {
  try {
    if (contentType.includes("text/event-stream")) {
      for (const line of text.split("\n").reverse()) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0 || payload === "[DONE]") continue;
        const parsed = asJsonRecord(JSON.parse(payload));
        if (typeof parsed?.model === "string" && parsed.model.length > 0) return parsed.model;
      }
      return null;
    }
    const parsed = asJsonRecord(JSON.parse(text));
    return typeof parsed?.model === "string" && parsed.model.length > 0 ? parsed.model : null;
  } catch {
    return null;
  }
}

function summarizeMetadata(metadata: Record<string, unknown> | null, cacheStatus: SandOpenRouterLastRoute["cacheStatus"]): Omit<SandOpenRouterLastRoute, "recordedAt"> {
  if (metadata == null) return { requestedModel: null, servedModel: null, providerName: null, strategy: null, attempt: null, cacheStatus };
  const endpoints = typeof metadata.endpoints === "object" && metadata.endpoints != null ? metadata.endpoints as { available?: unknown } : null;
  const available = Array.isArray(endpoints?.available) ? endpoints!.available as unknown[] : [];
  const selected = available.map(entry => typeof entry === "object" && entry != null ? entry as { selected?: unknown; provider?: unknown; model?: unknown } : null).find(entry => entry?.selected === true) ?? null;
  return {
    requestedModel: typeof metadata.requested === "string" ? metadata.requested : null,
    servedModel: selected != null && typeof selected.model === "string" ? selected.model : null,
    providerName: selected != null && typeof selected.provider === "string" ? selected.provider : null,
    strategy: typeof metadata.strategy === "string" ? metadata.strategy : null,
    attempt: Number.isSafeInteger(metadata.attempt) ? metadata.attempt as number : null,
    cacheStatus,
  };
}

export function summarizeOpenRouterRoute(metadata: Record<string, unknown> | null, cacheHeader: string | null, servedModel?: string | null): SandOpenRouterLastRoute {
  const status = cacheHeader === "HIT" || cacheHeader === "MISS" ? cacheHeader : null;
  const summarized = summarizeMetadata(metadata, status);
  return { ...summarized, servedModel: summarized.servedModel ?? (typeof servedModel === "string" && servedModel.length > 0 ? servedModel : null), recordedAt: new Date().toISOString() };
}

export interface OpenRouterInstrumentedFetchOptions {
  readonly cacheEnabled: boolean;
  readonly cacheTtlSeconds?: number;
  /** Only requests to URLs starting with this prefix are instrumented. */
  readonly urlPrefix?: string;
}

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Wraps fetch so OpenRouter calls opt into response caching and surface router
 * metadata. The original response is returned untouched; a clone is read in the
 * background to extract `openrouter_metadata` and the cache status header.
 */
export function createOpenRouterInstrumentedFetch(fetchImpl: FetchLike, options: OpenRouterInstrumentedFetchOptions, onRoute: (route: SandOpenRouterLastRoute) => void): FetchLike {
  const prefix = options.urlPrefix ?? "https://openrouter.ai/api/";
  return async (url, init) => {
    const href = url instanceof Request ? url.url : String(url instanceof URL ? url.href : url);
    const effective = href.startsWith(prefix);
    if (!effective) return fetchImpl(url, init);
    const headers = new Headers(init?.headers ?? (url instanceof Request ? url.headers : undefined));
    if (effective) {
      headers.set("X-OpenRouter-Metadata", "enabled");
      for (const [name, value] of Object.entries(openRouterCacheHeaders(options.cacheEnabled, options.cacheTtlSeconds))) headers.set(name, value);
    }
    const response = await fetchImpl(url, { ...init, headers });
    if (!effective) return response;
    const cacheHeader = response.headers.get("X-OpenRouter-Cache-Status");
    void (async () => {
      try {
        const text = await response.clone().text();
        if (text.length > 5_000_000) return;
        const contentType = response.headers.get("content-type") ?? "";
        onRoute(summarizeOpenRouterRoute(parseOpenRouterMetadataFromText(text, contentType), cacheHeader, parseOpenRouterServedModelFromText(text, contentType)));
      } catch {}
    })();
    return response;
  };
}

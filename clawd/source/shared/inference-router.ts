export const SAND_INFERENCE_PROVIDERS = ["cursor", "claude-code", "codex", "openrouter", "xai"] as const;
export type SandInferenceProvider = (typeof SAND_INFERENCE_PROVIDERS)[number];

/** User-selected free model roster; numbering intentionally preserves the missing slot 6. */
export const OPENROUTER_MODEL_PRESET = {
  OPENROUTER_MODEL: "nvidia/nemotron-3-ultra-550b-a55b:free",
  OPENROUTER_MODEL1: "poolside/laguna-s-2.1:free",
  OPENROUTER_MODEL2: "minimax/minimax-m3:free",
  OPENROUTER_MODEL3: "nvidia/nemotron-3.5-lightning:free",
  OPENROUTER_MODEL4: "inclusionai/ling-3.0-flash-fin:free",
  OPENROUTER_MODEL5: "minimax/minimax-m2.7:free",
  OPENROUTER_MODEL7: "nvidia/nemotron-3-super-120b-a12b:free",
  OPENROUTER_MODEL8: "thinkingmachines/inkling:free",
  OPENROUTER_MODEL9: "poolside/laguna-xs-2.1:free",
  OPENROUTER_MODEL10: "poolside/laguna-xs-2.1:free",
  OPENROUTER_MODEL11: "z-ai/glm-5.2:free",
  OPENROUTER_MODEL12: "liquid/lfm-2.5-2.6b:free",
  OPENROUTER_MODEL13: "liquid/lfm-2.5-2.6b:free",
  OPENROUTER_MODEL14: "nex-agi/nex-n2.5-mini:free",
  OPENROUTER_MODEL15: "inclusionai/ling-3.0-flash-sante:free",
} as const;
export const SAND_DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODEL_PRESET.OPENROUTER_MODEL;
export const OPENROUTER_AUTO_ROUTER_MODEL = "openrouter/auto";
export const OPENROUTER_AUTO_ROUTER_PLUGIN_ID = "auto-router";
export const OPENROUTER_AUTO_COST_TIERS = ["low", "medium", "high", "xhigh", "max"] as const;
export type OpenRouterAutoCostTier = (typeof OPENROUTER_AUTO_COST_TIERS)[number];

export interface OpenRouterAutoRouterRequest {
  readonly costTier?: OpenRouterAutoCostTier;
  readonly allowedModels?: readonly string[];
  readonly excludedModels?: readonly string[];
  readonly sessionId?: string;
}

export function resolveOpenRouterModelChain(env: Record<string, string | undefined> = {}, storedModel?: string): string[] {
  const primary = [env.OPENROUTER_MODEL, env.SAND_OPENROUTER_MODEL, env.OPENROUTER_GROK_MODEL, env.OPENROUTER_NEMO, storedModel]
    .map(normalizeSandOpenRouterModel).find(value => value != null) ?? SAND_DEFAULT_OPENROUTER_MODEL;
  if (isOpenRouterAutoRouter(primary)) return [OPENROUTER_AUTO_ROUTER_MODEL];
  const numberedKeys = Object.keys(env).filter(key => /^OPENROUTER_MODEL[1-9]\d*$/.test(key)).sort((a, b) => Number(a.slice(16)) - Number(b.slice(16)));
  const numbered = numberedKeys.map(key => normalizeSandOpenRouterModel(env[key])).filter((value): value is string => value != null);
  const fallback = (env.SAND_OPENROUTER_FALLBACK_MODELS ?? env.OPENROUTER_FALLBACK_MODELS ?? "").split(",").map(normalizeSandOpenRouterModel).filter((value): value is string => value != null);
  const defaults = numberedKeys.length === 0 && fallback.length === 0 && primary === SAND_DEFAULT_OPENROUTER_MODEL ? Object.values(OPENROUTER_MODEL_PRESET) : [];
  return [...new Set([primary, ...numbered, ...fallback, ...defaults])];
}

/** Direct xAI API routing against the user's own XAI_API_KEY credential. */
export const SAND_DEFAULT_XAI_MODEL = "grok-4.6";

/** Grok media models used by the local `grok_*` routed tools (overridable via env). */
export const SAND_DEFAULT_OPENROUTER_GROK_IMAGINE_MODEL = "x-ai/grok-imagine-image-2.0";
export const SAND_DEFAULT_OPENROUTER_GROK_VOICE_MODEL = "x-ai/grok-voice-tts-1.0";
export const SAND_DEFAULT_OPENROUTER_GROK_STT_MODEL = "x-ai/grok-stt-1.0";

/** Zero-cost OpenRouter TTS: the default voice for grok_speak and Telegram voice replies. */
export const SAND_DEFAULT_OPENROUTER_TTS_MODEL = "deepgram/flux-tts:free";

/**
 * Flux models reject synthesis without an explicit voice; this neutral
 * English voice is their documented default. Other providers keep their own.
 */
export const SAND_DEFAULT_OPENROUTER_TTS_VOICE = "flux-alexis-en";

export function openRouterTtsVoiceForModel(model: string, requested?: string | null): string | undefined {
  if (requested != null && requested.trim().length > 0) return requested.trim();
  return /flux-tts/i.test(model) ? SAND_DEFAULT_OPENROUTER_TTS_VOICE : undefined;
}

export const GROK_IMAGINE_MODEL_ENV = "OPENROUTER_GROK_IMAGINE";
export const GROK_VOICE_MODEL_ENV = "OPENROUTER_GROK_VOICE";
export const GROK_STT_MODEL_ENV = "OPENROUTER_GROK_STT";
export const OPENROUTER_TTS_MODEL_ENV = "OPENROUTER_VOICE";

export function normalizeSandOpenRouterModel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200 || !/^[A-Za-z0-9._\-/:]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export function isOpenRouterAutoRouter(value: unknown): boolean {
  return normalizeSandOpenRouterModel(value) === OPENROUTER_AUTO_ROUTER_MODEL;
}

/** Allow/exclude patterns for Auto Router, including `anthropic/*` wildcards. */
export function normalizeOpenRouterModelPattern(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200 || !/^[A-Za-z0-9._\-/*:]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function envText(env: Record<string, string | undefined>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value != null && value.length > 0) return value;
  }
  return undefined;
}

function parsePatternList(value: string | undefined): string[] | undefined {
  if (value == null) return undefined;
  const items = [...new Set(value.split(",").map(normalizeOpenRouterModelPattern).filter((item): item is string => item != null))];
  return items.length === 0 ? undefined : items;
}

export function resolveOpenRouterAutoRouterRequest(env: Record<string, string | undefined> = {}): OpenRouterAutoRouterRequest {
  const costRaw = envText(env, ["OPENROUTER_AUTO_COST_TIER", "SAND_OPENROUTER_AUTO_COST_TIER"])?.toLowerCase();
  const costTier = costRaw != null && (OPENROUTER_AUTO_COST_TIERS as readonly string[]).includes(costRaw) ? costRaw as OpenRouterAutoCostTier : undefined;
  const allowedModels = parsePatternList(envText(env, ["OPENROUTER_AUTO_ALLOWED_MODELS", "SAND_OPENROUTER_AUTO_ALLOWED_MODELS"]));
  const excludedModels = parsePatternList(envText(env, ["OPENROUTER_AUTO_EXCLUDED_MODELS", "SAND_OPENROUTER_AUTO_EXCLUDED_MODELS"]));
  const sessionId = envText(env, ["OPENROUTER_SESSION_ID", "SAND_OPENROUTER_SESSION_ID"]);
  return {
    ...(costTier == null ? {} : { costTier }),
    ...(allowedModels == null ? {} : { allowedModels }),
    ...(excludedModels == null ? {} : { excludedModels }),
    ...(sessionId == null || sessionId.length > 200 ? {} : { sessionId }),
  };
}

/** Build the Auto Router POST body: slug alone, no local `models[]`, optional plugin/session fields. */
export function applyOpenRouterAutoRouterPayload(body: Record<string, unknown>, request: OpenRouterAutoRouterRequest = {}): Record<string, unknown> {
  const { models: _models, plugins: _plugins, session_id: _session, ...rest } = body;
  const plugin: Record<string, unknown> = { id: OPENROUTER_AUTO_ROUTER_PLUGIN_ID };
  if (request.costTier != null) plugin.cost_tier = request.costTier;
  if (request.allowedModels != null && request.allowedModels.length > 0) plugin.allowed_models = [...request.allowedModels];
  if (request.excludedModels != null && request.excludedModels.length > 0) plugin.excluded_models = [...request.excludedModels];
  const sessionId = request.sessionId?.trim();
  return {
    ...rest,
    model: OPENROUTER_AUTO_ROUTER_MODEL,
    ...(sessionId != null && sessionId.length > 0 ? { session_id: sessionId } : {}),
    ...(Object.keys(plugin).length > 1 ? { plugins: [plugin] } : {}),
  };
}

export interface SandInferenceRouterUsageProvider {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly lastUsedAt: string | null;
  /** OpenRouter-only snapshot of what the router actually did on the most recent request. */
  readonly lastRoute?: import("./open-router-cache.js").SandOpenRouterLastRoute | null;
}

export interface SandInferenceRouterUsage {
  readonly schemaVersion: 1;
  readonly providers: Record<SandInferenceProvider, SandInferenceRouterUsageProvider>;
}

export function isSandInferenceProvider(value: unknown): value is SandInferenceProvider {
  return typeof value === "string" && (SAND_INFERENCE_PROVIDERS as readonly string[]).includes(value);
}

export function emptySandInferenceRouterUsage(): SandInferenceRouterUsage {
  const empty = (): SandInferenceRouterUsageProvider => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsedAt: null });
  return { schemaVersion: 1, providers: { cursor: empty(), "claude-code": empty(), codex: empty(), openrouter: empty(), xai: empty() } };
}

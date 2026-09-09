import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  GROK_IMAGINE_MODEL_ENV,
  GROK_STT_MODEL_ENV,
  GROK_VOICE_MODEL_ENV,
  OPENROUTER_TTS_MODEL_ENV,
  SAND_DEFAULT_OPENROUTER_GROK_IMAGINE_MODEL,
  SAND_DEFAULT_OPENROUTER_GROK_STT_MODEL,
  SAND_DEFAULT_OPENROUTER_TTS_MODEL,
  normalizeSandOpenRouterModel,
  openRouterTtsVoiceForModel,
} from "../shared/inference-router.js";
import { getBoxSecretsStorePath } from "../host/extensions/secrets/secrets-service.js";
import { getSandRootDir } from "../host/host-paths.js";

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const GROK_MEDIA_PROVIDER = "grok-bot-openrouter-media";

export function openRouterApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = env.OPENROUTER_API_KEY?.trim();
  if (direct != null && direct.length > 0) return direct;
  try {
    const parsed = JSON.parse(readFileSync(getBoxSecretsStorePath(), "utf8")) as { secrets?: Record<string, unknown> };
    const stored = parsed.secrets?.OPENROUTER_API_KEY;
    return typeof stored === "string" && stored.trim().length > 0 ? stored.trim() : undefined;
  } catch {
    return undefined;
  }
}

function configuredGrokModel(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return normalizeSandOpenRouterModel(env[name]) ?? fallback;
}

/**
 * Resolves the OpenRouter TTS model for speech synthesis. `OPENROUTER_VOICE`
 * wins (e.g. the zero-cost deepgram/flux-tts:free), then the legacy
 * `OPENROUTER_GROK_VOICE` pin, then the free default.
 */
export function resolveOpenRouterTtsModel(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeSandOpenRouterModel(env[OPENROUTER_TTS_MODEL_ENV])
    ?? normalizeSandOpenRouterModel(env[GROK_VOICE_MODEL_ENV])
    ?? SAND_DEFAULT_OPENROUTER_TTS_MODEL;
}

export interface GrokMediaFetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }): Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
}

interface GrokMediaOverrides {
  apiKey?: string;
  fetchImpl?: GrokMediaFetchLike;
  outputDir?: string;
}

let testOverrides: GrokMediaOverrides = {};

function resolveDeps(): { apiKey: string | undefined; fetchImpl: GrokMediaFetchLike; outputDir: string } {
  const overrides = testOverrides as GrokMediaOverrides;
  return {
    apiKey: "apiKey" in overrides ? overrides.apiKey : openRouterApiKey(),
    fetchImpl: overrides.fetchImpl ?? (globalThis.fetch as unknown as GrokMediaFetchLike),
    outputDir: overrides.outputDir ?? join(getSandRootDir(), "generated"),
  };
}

export function configureGrokMediaBridgeForTests(overrides: GrokMediaOverrides | null): void {
  testOverrides = overrides ?? {};
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function openRouterJson(fetchImpl: GrokMediaFetchLike, apiKey: string, path: string, body: Record<string, unknown>, timeoutMs = 180_000): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${OPENROUTER_API_BASE}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "HTTP-Referer": "https://github.com/grok-bot-reconstructed", "X-Title": "Clawd Bot Reconstructed" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = record(await response.json());
        const error = record(payload?.error);
        if (typeof payload?.detail === "string") detail = payload.detail;
        if (typeof error?.message === "string") detail = error.message;
      } catch {}
      throw new Error(`OpenRouter ${path} failed: ${detail}`);
    }
    const payload = record(await response.json());
    if (payload == null) throw new Error(`OpenRouter ${path} returned an unreadable response.`);
    return payload;
  } finally { clearTimeout(timeout); }
}

async function openRouterBinary(fetchImpl: GrokMediaFetchLike, apiKey: string, path: string, body: Record<string, unknown>): Promise<{ bytes: Uint8Array; generationId: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${OPENROUTER_API_BASE}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "HTTP-Referer": "https://github.com/grok-bot-reconstructed", "X-Title": "Clawd Bot Reconstructed" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = record(await response.json());
        const error = record(payload?.error);
        if (typeof error?.message === "string") detail = error.message;
      } catch {}
      throw new Error(`OpenRouter ${path} failed: ${detail}`);
    }
    return { bytes: new Uint8Array(await response.arrayBuffer()), generationId: response.headers.get("x-generation-id") };
  } finally { clearTimeout(timeout); }
}

function saveGenerated(outputDir: string, stem: string, extension: string, bytes: Uint8Array): { path: string; bytes: number } {
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(outputDir, `${stem}-${stamp}.${extension}`);
  writeFileSync(target, bytes, { mode: 0o600 });
  return { path: target, bytes: bytes.byteLength };
}

type GrokRoutedToolSchema = Record<string, unknown>;

const IMAGINE_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string", minLength: 1, description: "Text description of the image to generate." },
    aspect_ratio: { type: "string", enum: ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1", "auto"] },
    resolution: { type: "string", enum: ["1K", "2K"] },
    quality: { type: "string", enum: ["low", "medium"] },
  },
  required: ["prompt"],
  additionalProperties: false,
} as const;

const SPEAK_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, maxLength: 4096, description: "The text to synthesize into speech." },
    voice: { type: "string", description: 'Voice id for the TTS model, e.g. "flux-alexis-en" (deepgram/flux) or "eve" (xAI Grok). Omit to use the model default.' },
    format: { type: "string", enum: ["mp3", "wav", "pcm"], description: "Audio container for the returned file (default mp3)." },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

const TRANSCRIBE_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: "Absolute path to a local audio file (wav, mp3, flac, m4a, ogg, webm, aac)." },
    format: { type: "string", description: "Audio format override when it cannot be inferred from the file extension." },
    language: { type: "string", description: 'Optional ISO-639-1 language hint, e.g. "en". Auto-detected when omitted.' },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

export interface GrokRoutedTool {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export const GROK_ROUTED_TOOLS: readonly GrokRoutedTool[] = [
  {
    name: "grok_imagine",
    toolName: "grok_imagine",
    providerIdentifier: GROK_MEDIA_PROVIDER,
    description: "Generate an image from a text prompt with x-ai/grok-imagine-image-2.0 through OpenRouter and save it locally. Use whenever the user asks you to draw, render, or imagine a picture.",
    inputSchema: IMAGINE_SCHEMA,
  },
  {
    name: "grok_speak",
    toolName: "grok_speak",
    providerIdentifier: GROK_MEDIA_PROVIDER,
    description: "Synthesize natural speech audio from text with the free deepgram/flux-tts:free model through OpenRouter (no extra cost) and save it as a local audio file. Use when the user asks you to say or read something aloud. Override with OPENROUTER_VOICE or OPENROUTER_GROK_VOICE (e.g. x-ai/grok-voice-tts-1.0).",
    inputSchema: SPEAK_SCHEMA,
  },
  {
    name: "grok_transcribe",
    toolName: "grok_transcribe",
    providerIdentifier: GROK_MEDIA_PROVIDER,
    description: "Transcribe a local audio file to text with x-ai/grok-stt-1.0 through OpenRouter.",
    inputSchema: TRANSCRIBE_SCHEMA,
  },
];

export function grokMediaRoutedTools(): readonly GrokRoutedTool[] {
  if (resolveDeps().apiKey == null) return [];
  return GROK_ROUTED_TOOLS;
}

export function isGrokMediaRoutedTool(name: unknown): boolean {
  return typeof name === "string" && GROK_ROUTED_TOOLS.some(tool => tool.name === name);
}

const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = { wav: "wav", mp3: "mp3", flac: "flac", m4a: "m4a", ogg: "ogg", webm: "webm", aac: "aac" };

function inferAudioFormat(path: string): string | undefined {
  const match = /\.([A-Za-z0-9]+)$/.exec(path.trim());
  const extension = match?.[1]?.toLowerCase();
  return extension != null ? AUDIO_EXTENSIONS[extension] : undefined;
}

async function executeImagine(args: Record<string, unknown>): Promise<unknown> {
  const prompt = args.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) throw new Error("grok_imagine requires a non-empty prompt.");
  const aspectRatio = typeof args.aspect_ratio === "string" ? args.aspect_ratio : undefined;
  const resolution = args.resolution === "1K" || args.resolution === "2K" ? args.resolution : undefined;
  const quality = args.quality === "low" || args.quality === "medium" ? args.quality : undefined;
  const { apiKey, fetchImpl, outputDir } = resolveDeps();
  if (apiKey == null) throw new Error("Set OPENROUTER_API_KEY to use the Grok media tools (Settings → Router).");
  const model = configuredGrokModel(process.env, GROK_IMAGINE_MODEL_ENV, SAND_DEFAULT_OPENROUTER_GROK_IMAGINE_MODEL);
  const payload = await openRouterJson(fetchImpl, apiKey, "/images", {
    model,
    prompt: prompt.trim(),
    ...(aspectRatio == null ? {} : { aspect_ratio: aspectRatio }),
    ...(resolution == null ? {} : { resolution }),
    ...(quality == null ? {} : { quality }),
  });
  const data = Array.isArray(payload.data) ? payload.data.flatMap(row => {
    const image = record(row);
    const base64 = typeof image?.b64_json === "string" ? image.b64_json : null;
    if (base64 == null) return [];
    return [{ base64, mediaType: typeof image!.media_type === "string" ? image!.media_type as string : undefined }];
  }) : [];
  if (data.length === 0) throw new Error(`OpenRouter /images returned no images for model ${model}.`);
  const usage = record(payload.usage);
  const files = data.map((image, index) => saveGenerated(outputDir, "grok-imagine", image.mediaType?.includes("jpeg") === true ? "jpg" : "png", Uint8Array.from(Buffer.from(image.base64, "base64"))));
  return {
    ok: true,
    model,
    count: files.length,
    files,
    ...(usage == null ? {} : { usage }),
    note: "Images are saved on this Mac at the paths above; share them by opening the folder in Finder.",
  };
}

async function executeSpeak(args: Record<string, unknown>): Promise<unknown> {
  const text = args.text;
  if (typeof text !== "string" || text.trim().length === 0) throw new Error("grok_speak requires non-empty text.");
  const voice = typeof args.voice === "string" && args.voice.trim().length > 0 ? args.voice.trim() : undefined;
  const format = args.format === "wav" || args.format === "pcm" ? args.format : "mp3";
  const { apiKey, fetchImpl, outputDir } = resolveDeps();
  if (apiKey == null) throw new Error("Set OPENROUTER_API_KEY to use the Grok media tools (Settings → Router).");
  const model = resolveOpenRouterTtsModel(process.env);
  const effectiveVoice = openRouterTtsVoiceForModel(model, voice);
  const { bytes, generationId } = await openRouterBinary(fetchImpl, apiKey, "/audio/speech", {
    model,
    input: text.trim(),
    ...(effectiveVoice == null ? {} : { voice: effectiveVoice }),
    response_format: format,
  });
  if (bytes.byteLength === 0) throw new Error(`OpenRouter /audio/speech returned no audio for model ${model}.`);
  const file = saveGenerated(outputDir, "grok-speech", format, bytes);
  return { ok: true, model, ...(effectiveVoice == null ? {} : { voice: effectiveVoice }), format, file, generationId, note: "Audio is saved on this Mac at the path above." };
}

export interface GrokSpeechRequest {
  readonly text: string;
  readonly voice?: string | undefined;
  readonly format?: "mp3" | "wav" | "pcm";
}

/**
 * Free OpenRouter TTS for renderer playback (Read aloud). Same model chain as
 * grok_speak (OPENROUTER_VOICE → OPENROUTER_GROK_VOICE → deepgram/flux-tts:free)
 * but returns base64 bytes instead of writing a file.
 */
export async function synthesizeGrokSpeech(request: GrokSpeechRequest): Promise<{
  ok: true;
  model: string;
  format: string;
  audioBase64: string;
  bytes: number;
  generationId: string | null;
}> {
  const text = request.text.trim();
  if (text.length === 0) throw new Error("speechSynthesize requires non-empty text.");
  const { apiKey, fetchImpl } = resolveDeps();
  if (apiKey == null) throw new Error("Set OPENROUTER_API_KEY to use free speech (Settings → Router).");
  const model = resolveOpenRouterTtsModel(process.env);
  const format = request.format ?? "mp3";
  const voice = openRouterTtsVoiceForModel(model, request.voice);
  const { bytes, generationId } = await openRouterBinary(fetchImpl, apiKey, "/audio/speech", {
    model,
    input: text,
    ...(voice == null ? {} : { voice }),
    response_format: format,
  });
  if (bytes.byteLength === 0) throw new Error(`OpenRouter /audio/speech returned no audio for model ${model}.`);
  return {
    ok: true,
    model,
    format,
    audioBase64: Buffer.from(bytes).toString("base64"),
    bytes: bytes.byteLength,
    generationId,
  };
}

async function executeTranscribe(args: Record<string, unknown>): Promise<unknown> {
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (path.length === 0) throw new Error("grok_transcribe requires the path of a local audio file.");
  let raw: Buffer;
  try { raw = readFileSync(path); }
  catch { throw new Error(`Could not read the audio file at ${path}.`); }
  if (raw.byteLength === 0) throw new Error(`The audio file at ${path} is empty.`);
  const format = typeof args.format === "string" && args.format.trim().length > 0 ? args.format.trim().toLowerCase() : inferAudioFormat(path);
  if (format == null || !(format in AUDIO_EXTENSIONS)) {
    throw new Error(`Cannot determine the audio format of ${path}; pass format explicitly (wav, mp3, flac, m4a, ogg, webm, aac).`);
  }
  const { apiKey, fetchImpl } = resolveDeps();
  if (apiKey == null) throw new Error("Set OPENROUTER_API_KEY to use the Grok media tools (Settings → Router).");
  const model = configuredGrokModel(process.env, GROK_STT_MODEL_ENV, SAND_DEFAULT_OPENROUTER_GROK_STT_MODEL);
  const payload = await openRouterJson(fetchImpl, apiKey, "/audio/transcriptions", {
    model,
    input_audio: { data: raw.toString("base64"), format },
    ...(typeof args.language === "string" && args.language.trim().length > 0 ? { language: args.language.trim() } : {}),
  }, 300_000);
  const text = payload.text;
  if (typeof text !== "string") throw new Error(`OpenRouter /audio/transcriptions returned no transcript for model ${model}.`);
  const usage = record(payload.usage);
  return { ok: true, model, path, format, text, ...(usage == null ? {} : { usage }) };
}

export async function executeGrokMediaRoutedTool(name: string, args: unknown): Promise<unknown> {
  const row = record(args) ?? {};
  switch (name) {
    case "grok_imagine": return await executeImagine(row);
    case "grok_speak": return await executeSpeak(row);
    case "grok_transcribe": return await executeTranscribe(row);
    default: throw new Error(`Unknown Grok media tool: ${name}`);
  }
}

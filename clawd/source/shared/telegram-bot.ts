export const TELEGRAM_BOT_SECRET_KEY = "TELEGRAM_BOT_TOKEN";
export const TELEGRAM_API_BASE = "https://api.telegram.org";
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Telegram issues bot tokens as `<bot id>:<secret>` where the secret is a
 * roughly 35-character case-sensitive string of alphanumerics, dashes, and
 * underscores. The bounds here accept every documented shape while rejecting
 * free-form text that would leak into an Authorization header.
 */
const TELEGRAM_TOKEN_PATTERN = /^\d{5,14}:[A-Za-z0-9_-]{30,60}$/;

export function normalizeSandTelegramBotToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80 || !TELEGRAM_TOKEN_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

export interface TelegramBotStatus {
  readonly configured: boolean;
  readonly running: boolean;
  readonly username: string | null;
  readonly handledMessages: number;
  readonly startedAtMs: number | null;
  readonly lastError: string | null;
  readonly deepgramConfigured: boolean;
  readonly voiceRepliesChats: number;
  readonly voiceGatewayUrl: string;
}

export function emptyTelegramBotStatus(): TelegramBotStatus {
  return { configured: false, running: false, username: null, handledMessages: 0, startedAtMs: null, lastError: null, deepgramConfigured: false, voiceRepliesChats: 0, voiceGatewayUrl: SAND_VOICE_GATEWAY_URL };
}

/** Telegram hard-caps one message at 4096 UTF-16 code units. */
export function formatTelegramReply(text: string): string {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length <= TELEGRAM_MESSAGE_LIMIT) return trimmed.length === 0 ? "(no reply)" : trimmed;
  return `${trimmed.slice(0, TELEGRAM_MESSAGE_LIMIT - 1)}…`;
}

export interface ParsedTelegramCommand {
  readonly command: string;
  readonly args: string;
}

/** Splits `/start@MyBot extra args` into its command and argument tail. */
export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
  if (typeof text !== "string") return null;
  const match = /^\/([A-Za-z][A-Za-z0-9_]{0,31})(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (match == null) return null;
  return { command: match[1]!.toLowerCase(), args: (match[2] ?? "").trim() };
}

export function telegramApiUrl(token: string, method: string, base: string = TELEGRAM_API_BASE): string {
  return `${base.replace(/\/+$/, "")}/bot${encodeURIComponent(token)}/${method}`;
}

/** Bot API file download endpoint (voice notes and other downloadable media). */
export function telegramFileUrl(token: string, filePath: string, base: string = TELEGRAM_API_BASE): string {
  return `${base.replace(/\/+$/, "")}/file/bot${encodeURIComponent(token)}/${String(filePath).replace(/^\/+/, "")}`;
}

export const DEEPGRAM_SECRET_KEY = "DEEPGRAM_API_KEY";
export const DEEPGRAM_STT_BASE = "https://api.deepgram.com/v1/listen";
export const DEEPGRAM_TTS_BASE = "https://api.deepgram.com/v1/speak";
export const SAND_DEFAULT_DEEPGRAM_STT_MODEL = "nova-3";
export const SAND_DEFAULT_DEEPGRAM_TTS_MODEL = "aura-2-thalia-en";

function normalizeSandModelId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(trimmed) ? trimmed : fallback;
}

export function normalizeSandDeepgramSttModel(value: unknown): string {
  return normalizeSandModelId(value, SAND_DEFAULT_DEEPGRAM_STT_MODEL);
}

export function normalizeSandDeepgramTtsModel(value: unknown): string {
  return normalizeSandModelId(value, SAND_DEFAULT_DEEPGRAM_TTS_MODEL);
}

export function normalizeSandDeepgramApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length < 16 || trimmed.length > 200 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Realtime voice gateway. The Cheshire/Clawd LiveKit deployment is the
 * designated endpoint for future duplex sessions; today it answers only a
 * keepalive GET at its root.
 */
export const SAND_VOICE_GATEWAY_URL = "https://cheshire-clawd-livekit-grok-crimson-bush-9215.fly.dev";

export function normalizeSandVoiceGatewayUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(trimmed) || trimmed.length > 300) return undefined;
  return trimmed;
}

/** Telegram accepts voice notes as OGG/Opus; Aura TTS produces exactly that. */
export function deepgramTtsUrl(model: string = SAND_DEFAULT_DEEPGRAM_TTS_MODEL, base: string = DEEPGRAM_TTS_BASE): string {
  return `${base.replace(/\/+$/, "")}?model=${encodeURIComponent(normalizeSandDeepgramTtsModel(model))}&encoding=opus&container=ogg`;
}

export function deepgramSttUrl(options?: { readonly model?: string; readonly language?: string; readonly base?: string }): string {
  const base = (options?.base ?? DEEPGRAM_STT_BASE).replace(/\/+$/, "");
  const model = normalizeSandDeepgramSttModel(options?.model);
  const language = typeof options?.language === "string" && options.language.trim().length > 0 && options.language.length <= 12 ? options.language.trim() : null;
  return `${base}?model=${encodeURIComponent(model)}&smart_format=true${language == null ? "" : `&language=${encodeURIComponent(language)}`}`;
}

/** Pulls the best transcript out of a Deepgram prerecorded STT response. */
export function parseDeepgramTranscript(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const results = isRecord(payload.results) ? payload.results : Array.isArray(payload.results) ? { channels: [] } : null;
  if (results == null) return null;
  const channels = Array.isArray(results.channels) ? results.channels : [];
  const alternatives = isRecord(channels[0]) && Array.isArray((channels[0] as { alternatives?: unknown }).alternatives) ? (channels[0] as { alternatives: unknown[] }).alternatives : [];
  const transcript = isRecord(alternatives[0]) ? (alternatives[0] as { transcript?: unknown }).transcript : undefined;
  if (typeof transcript !== "string") return null;
  const trimmed = transcript.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface RawTelegramChat { readonly id?: unknown; readonly type?: unknown }
interface RawTelegramFrom { readonly username?: unknown; readonly first_name?: unknown; readonly last_name?: unknown }
interface RawTelegramFileLike { readonly file_id?: unknown; readonly duration?: unknown; readonly mime_type?: unknown }
interface RawTelegramMessage { readonly message_id?: unknown; readonly chat?: unknown; readonly from?: unknown; readonly text?: unknown; readonly caption?: unknown; readonly voice?: unknown; readonly audio?: unknown }

export interface TelegramIncomingMessage {
  readonly updateId: number;
  readonly chatId: number | string;
  readonly chatType: string;
  readonly senderName: string;
  readonly text: string;
  /** Bot API file id of an attached voice note or audio file, if any. */
  readonly voiceFileId: string | null;
}

function telegramFileId(raw: RawTelegramFileLike | undefined): string | null {
  if (!isRecord(raw)) return null;
  const fileId = raw.file_id;
  return typeof fileId === "string" && fileId.length > 0 && fileId.length <= 256 ? fileId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function senderName(from: RawTelegramFrom | undefined): string {
  if (!isRecord(from)) return "friend";
  const first = typeof from.first_name === "string" ? from.first_name.trim() : "";
  const last = typeof from.last_name === "string" ? from.last_name.trim() : "";
  if (first.length > 0 || last.length > 0) return `${first} ${last}`.trim();
  if (typeof from.username === "string" && from.username.trim().length > 0) return `@${from.username.trim()}`;
  return "friend";
}

/**
 * Projects a raw Bot API `getUpdates` payload onto the narrow shape the
 * bridge consumes. Text messages and voice/audio notes survive; edits,
 * callbacks, photos, video, and other media updates are dropped so the model
 * never sees stale edit histories or unhandled payloads.
 */
export function parseTelegramUpdateMessages(payload: unknown): TelegramIncomingMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.result)) return [];
  const messages: TelegramIncomingMessage[] = [];
  for (const raw of payload.result) {
    if (!isRecord(raw)) continue;
    const updateId = typeof raw.update_id === "number" && Number.isSafeInteger(raw.update_id) ? raw.update_id : null;
    const message = isRecord(raw.message) ? raw.message as RawTelegramMessage : null;
    if (updateId == null || message == null) continue;
    const chat = isRecord(message.chat) ? message.chat as RawTelegramChat : undefined;
    if (chat?.id == null || (typeof chat.id !== "number" && typeof chat.id !== "string")) continue;
    const text = typeof message.text === "string" ? message.text.trim() : "";
    const caption = typeof message.caption === "string" ? message.caption.trim() : "";
    const voiceFileId = telegramFileId(isRecord(message.voice) ? message.voice as RawTelegramFileLike : undefined)
      ?? telegramFileId(isRecord(message.audio) ? message.audio as RawTelegramFileLike : undefined);
    if (text.length === 0 && caption.length === 0 && voiceFileId == null) continue;
    messages.push({
      updateId,
      chatId: chat.id,
      chatType: typeof chat.type === "string" ? chat.type : "private",
      senderName: senderName(isRecord(message.from) ? message.from as RawTelegramFrom : undefined),
      text: text.length > 0 ? text : caption,
      voiceFileId,
    });
  }
  return messages;
}

import { normalizeSandOpenRouterModel, OPENROUTER_TTS_MODEL_ENV, openRouterTtsVoiceForModel, SAND_DEFAULT_OPENROUTER_TTS_MODEL } from "../../shared/inference-router.js";
import {
  DEEPGRAM_SECRET_KEY,
  SAND_VOICE_GATEWAY_URL,
  TELEGRAM_BOT_SECRET_KEY,
  deepgramSttUrl,
  deepgramTtsUrl,
  emptyTelegramBotStatus,
  formatTelegramReply,
  normalizeSandDeepgramApiKey,
  normalizeSandTelegramBotToken,
  normalizeSandVoiceGatewayUrl,
  parseDeepgramTranscript,
  parseTelegramCommand,
  parseTelegramUpdateMessages,
  telegramApiUrl,
  telegramFileUrl,
  type TelegramBotStatus,
  type TelegramIncomingMessage,
} from "../../shared/telegram-bot.js";

const OPENROUTER_API_SECRET_KEY = "OPENROUTER_API_KEY";
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

const INTRO_TEXT = [
  "Hi! I'm your own Telegram bot, powered by your Grok Bot desktop app.",
  "Ask me anything — I answer with your configured Router model (OpenRouter by default) and can inspect Solana wallets, assets, and the live pump.fun launch tape.",
  "You can also send voice notes: they are transcribed with Deepgram and answered like any other message.",
  "Commands: /help, /status, /voice. Everything else goes straight to the model.",
].join("\n");

const HELP_TEXT = [
  "This bot runs locally on your machine and talks to the Grok Bot inference router.",
  "",
  "• Send any message and it is answered by your selected Router provider (OpenRouter free models by default).",
  "• Available tools: Solana wallet/asset lookups (read-only) and live pump.fun launch data.",
  "• Voice notes are transcribed with Deepgram STT; with /voice on, replies also arrive as spoken voice notes (Deepgram Aura TTS, or free OpenRouter TTS via OPENROUTER_VOICE=deepgram/flux-tts:free).",
  "• /status shows connection state; /start or /help reprints this text; /voice toggles spoken replies for this chat.",
  "• Secrets live in your OS-protected secret store and never leave this machine except to reach Telegram, OpenRouter, Solana RPC, and Deepgram.",
].join("\n");

const NO_DEEPGRAM_TEXT = [
  "I can't listen yet: no DEEPGRAM_API_KEY is configured.",
  "Save one under Settings → Router (secret key DEEPGRAM_API_KEY) or restart the app with DEEPGRAM_API_KEY set.",
].join(" ");

const NO_SPEECH_TEXT = [
  "I can't speak yet: no text-to-speech provider is configured.",
  "Save a DEEPGRAM_API_KEY secret under Settings → Router, or set OPENROUTER_VOICE=deepgram/flux-tts:free alongside OPENROUTER_API_KEY for zero-cost spoken replies through OpenRouter.",
].join(" ");

export interface TelegramBotServiceDeps {
  readonly revealSecret: (key: string) => Promise<string | null>;
  readonly upsertSecret: (entries: Record<string, string>) => Promise<void>;
  readonly removeSecret: (keys: readonly string[]) => Promise<void>;
  /** Runs one routed-inference turn (OpenRouter + tools) and returns the reply text. */
  readonly runTurn: (prompt: string) => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly apiBase?: string;
  readonly envToken?: string | undefined;
  readonly envDeepgramKey?: string | undefined;
  /** OPENROUTER_API_KEY from the process environment (secret store is consulted first). */
  readonly envOpenRouterKey?: string | undefined;
  /** OPENROUTER_VOICE TTS model override, e.g. deepgram/flux-tts:free. */
  readonly envVoiceModel?: string | undefined;
  readonly voiceGatewayUrl?: string | undefined;
  readonly maxVoiceBytes?: number;
  readonly pollTimeoutSeconds?: number;
  readonly now?: () => number;
  readonly onStatus?: (status: TelegramBotStatus) => void;
}

interface TelegramApiResponse {
  readonly ok: boolean;
  readonly description?: unknown;
  readonly result?: unknown;
}

export function createTelegramBotService(deps: TelegramBotServiceDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiBase = deps.apiBase?.trim() || undefined;
  const now = deps.now ?? Date.now;
  const pollTimeoutSeconds = Math.min(50, Math.max(1, Math.floor(deps.pollTimeoutSeconds ?? 25)));
  const maxVoiceBytes = Math.min(25_000_000, Math.max(100_000, deps.maxVoiceBytes ?? 20_000_000));
  const voiceGatewayUrl = normalizeSandVoiceGatewayUrl(deps.voiceGatewayUrl) ?? SAND_VOICE_GATEWAY_URL;

  let status: TelegramBotStatus = { ...emptyTelegramBotStatus(), voiceGatewayUrl };
  let stopped = true;
  let loopGeneration = 0;
  let offset = 0;
  let deepgramConfigured = false;
  let openRouterTtsModel: string | null = null;
  const voiceReplyChats = new Set<string>();

  const publish = (): void => { deps.onStatus?.(status); };

  const setStatus = (patch: Partial<TelegramBotStatus>): void => {
    status = { ...status, ...patch };
    publish();
  };

  const callApi = async (token: string, method: string, query: Record<string, string> = {}): Promise<TelegramApiResponse> => {
    const url = new URL(telegramApiUrl(token, method, apiBase));
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await fetchImpl(url, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as TelegramApiResponse | null;
    if (payload == null || typeof payload !== "object") throw new Error(`Telegram ${method} returned a non-JSON response.`);
    if (payload.ok !== true) throw new Error(`Telegram ${method} failed: ${typeof payload.description === "string" ? payload.description : `HTTP ${response.status}`}`);
    return payload;
  };

  const resolveToken = async (): Promise<string> => {
    const stored = normalizeSandTelegramBotToken(await deps.revealSecret(TELEGRAM_BOT_SECRET_KEY));
    if (stored != null) return stored;
    const fromEnv = normalizeSandTelegramBotToken(deps.envToken);
    if (fromEnv != null) return fromEnv;
    throw new Error("No Telegram bot token saved yet. Create a bot with @BotFather and save its token first.");
  };

  const resolveDeepgramKey = async (): Promise<string | null> => {
    return normalizeSandDeepgramApiKey(await deps.revealSecret(DEEPGRAM_SECRET_KEY))
      ?? normalizeSandDeepgramApiKey(deps.envDeepgramKey)
      ?? null;
  };

  const firstNonEmpty = (value: string | null | undefined): string | null => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  };

  /** OPENROUTER_API_KEY: secret store first, then the process environment. */
  const resolveOpenRouterKey = async (): Promise<string | null> => {
    return firstNonEmpty(await deps.revealSecret(OPENROUTER_API_SECRET_KEY))
      ?? firstNonEmpty(deps.envOpenRouterKey);
  };

  /** OPENROUTER_VOICE model override (must look like "vendor/model"); null means "no explicit pin". */
  const resolveOpenRouterVoiceModel = async (): Promise<string | null> => {
    const pick = (value: unknown): string | null => {
      const normalized = normalizeSandOpenRouterModel(value);
      return normalized != null && normalized.includes("/") ? normalized : null;
    };
    return pick(await deps.revealSecret(OPENROUTER_TTS_MODEL_ENV)) ?? pick(deps.envVoiceModel) ?? null;
  };

  /** Refreshes cached provider readiness; true when any TTS provider is usable. */
  const probeSpeechReadiness = async (): Promise<boolean> => {
    const [deepgramKey, openRouterKey] = await Promise.all([resolveDeepgramKey(), resolveOpenRouterKey()]);
    deepgramConfigured = deepgramKey != null;
    const pinned = await resolveOpenRouterVoiceModel();
    openRouterTtsModel = openRouterKey == null ? null : pinned ?? SAND_DEFAULT_OPENROUTER_TTS_MODEL;
    setStatus({ deepgramConfigured });
    return deepgramConfigured || openRouterKey != null;
  };

  const speechServiceLabel = (): string => {
    const parts: string[] = [];
    if (deepgramConfigured) parts.push("Deepgram STT/TTS");
    if (openRouterTtsModel != null) parts.push(`OpenRouter TTS (${openRouterTtsModel})`);
    return parts.length > 0 ? parts.join(" + ") : "not configured";
  };

  const sendMessage = async (token: string, chatId: number | string, text: string): Promise<void> => {
    await callApi(token, "sendMessage", { chat_id: String(chatId), text: formatTelegramReply(text) });
  };

  /** Downloads a Bot API file (bounded) and returns its bytes. */
  const downloadFile = async (token: string, fileId: string): Promise<Uint8Array> => {
    const file = await callApi(token, "getFile", { file_id: fileId });
    const filePath = typeof (file.result as { file_path?: unknown } | null)?.file_path === "string" ? String((file.result as { file_path?: unknown }).file_path) : null;
    if (filePath == null || filePath.length === 0) throw new Error("Telegram did not return a downloadable path for that voice note.");
    const response = await fetchImpl(telegramFileUrl(token, filePath, apiBase), { cache: "no-store" });
    if (!response.ok) throw new Error(`Downloading the voice note failed: HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxVoiceBytes) throw new Error(`That voice note is too large (${bytes.byteLength} bytes); keep recordings under ~20 MB.`);
    return bytes;
  };

  /** Deepgram prerecorded STT over a Telegram voice note. */
  const transcribeVoice = async (audio: Uint8Array): Promise<string> => {
    const key = await resolveDeepgramKey();
    if (key == null) throw new Error(NO_DEEPGRAM_TEXT);
    const response = await fetchImpl(deepgramSttUrl(), {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": "application/octet-stream" },
      body: audio as unknown as BodyInit,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload != null && typeof payload === "object" && typeof (payload as { err_msg?: unknown }).err_msg === "string" ? String((payload as { err_msg?: unknown }).err_msg) : `HTTP ${response.status}`;
      throw new Error(`Deepgram transcription failed: ${detail}`);
    }
    return parseDeepgramTranscript(payload) ?? "";
  };

  /** Speech bytes plus the container metadata Telegram's sendVoice needs. */
  interface SynthesizedSpeech {
    readonly audio: Uint8Array;
    readonly filename: string;
    readonly contentType: string;
  }

  /** Free OpenRouter TTS (`OPENROUTER_VOICE`, default deepgram/flux-tts:free) as mp3. */
  const openRouterSpeech = async (apiKey: string, model: string, text: string): Promise<SynthesizedSpeech> => {
    const response = await fetchImpl(OPENROUTER_SPEECH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://github.com/grok-bot-reconstructed",
        "X-Title": "Clawd Bot Reconstructed",
      },
      body: JSON.stringify({ model, input: text, voice: openRouterTtsVoiceForModel(model), response_format: "mp3" }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenRouter speech synthesis failed: HTTP ${response.status}${detail.length > 0 ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) throw new Error(`OpenRouter speech synthesis returned no audio for ${model}.`);
    return { audio, filename: "reply.mp3", contentType: "audio/mpeg" };
  };

  /** Deepgram Aura TTS rendered to OGG/Opus, ready for Telegram voice notes. */
  const deepgramSpeech = async (key: string, text: string): Promise<SynthesizedSpeech> => {
    const response = await fetchImpl(deepgramTtsUrl(), {
      method: "POST",
      headers: { authorization: `Token ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Deepgram speech synthesis failed: HTTP ${response.status}${detail.length > 0 ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return { audio: new Uint8Array(await response.arrayBuffer()), filename: "reply.ogg", contentType: "audio/ogg" };
  };

  /**
   * Picks a TTS provider for spoken replies. An explicit OPENROUTER_VOICE pin
   * wins; otherwise Deepgram Aura stays the default when configured; an
   * OpenRouter key alone still gets free deepgram/flux-tts:free voice.
   */
  const synthesizeSpeech = async (text: string): Promise<SynthesizedSpeech> => {
    const voiceModel = await resolveOpenRouterVoiceModel();
    const openRouterKey = await resolveOpenRouterKey();
    if (openRouterKey != null && voiceModel != null) {
      openRouterTtsModel = voiceModel;
      return await openRouterSpeech(openRouterKey, voiceModel, text);
    }
    const deepgramKey = await resolveDeepgramKey();
    if (deepgramKey != null) return await deepgramSpeech(deepgramKey, text);
    if (openRouterKey != null) {
      openRouterTtsModel = SAND_DEFAULT_OPENROUTER_TTS_MODEL;
      return await openRouterSpeech(openRouterKey, SAND_DEFAULT_OPENROUTER_TTS_MODEL, text);
    }
    throw new Error(NO_SPEECH_TEXT);
  };

  const sendVoiceNote = async (token: string, chatId: number | string, speech: SynthesizedSpeech): Promise<void> => {
    const boundary = `sandvoice${Math.random().toString(36).slice(2)}${now().toString(36)}`;
    const head = Buffer.from([
      `--${boundary}\r\n`,
      'content-disposition: form-data; name="chat_id"\r\n\r\n',
      `${String(chatId)}\r\n`,
      `--${boundary}\r\n`,
      `content-disposition: form-data; name="voice"; filename="${speech.filename}"\r\n`,
      `content-type: ${speech.contentType}\r\n\r\n`,
    ].join(""));
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const multipart = Buffer.concat([head, Buffer.from(speech.audio), tail]);
    const response = await fetchImpl(telegramApiUrl(token, "sendVoice", apiBase), {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: multipart as unknown as BodyInit,
    });
    const payload = await response.json().catch(() => null) as TelegramApiResponse | null;
    if (payload == null || payload.ok !== true) {
      const detail = payload != null && typeof payload.description === "string" ? payload.description : `HTTP ${response.status}`;
      throw new Error(`Sending the voice reply failed: ${detail}`);
    }
  };

  const handleCommand = async (token: string, message: TelegramIncomingMessage): Promise<boolean> => {
    const command = parseTelegramCommand(message.text);
    if (command == null) return false;
    if (command.command === "start" || command.command === "help") {
      await sendMessage(token, message.chatId, command.command === "start" ? INTRO_TEXT : HELP_TEXT);
      return true;
    }
    if (command.command === "status") {
      const lines = [
        `running: ${status.running ? "yes" : "no"}`,
        `bot: ${status.username == null ? "unknown" : `@${status.username}`}`,
        `messages handled: ${status.handledMessages}`,
        `voice replies here: ${voiceReplyChats.has(String(message.chatId)) ? "on" : "off"} (${voiceReplyChats.size} chats)`,
        `speech service: ${speechServiceLabel()}`,
        `voice gateway: ${voiceGatewayUrl}`,
        ...(status.lastError == null ? [] : [`last error: ${status.lastError}`]),
      ];
      await sendMessage(token, message.chatId, lines.join("\n"));
      return true;
    }
    if (command.command === "voice") {
      const requested = command.args.toLowerCase();
      const enabled = requested === "on" ? true : requested === "off" ? false : !voiceReplyChats.has(String(message.chatId));
      if (enabled && !(await probeSpeechReadiness())) {
        await sendMessage(token, message.chatId, NO_SPEECH_TEXT);
        return true;
      }
      if (enabled) voiceReplyChats.add(String(message.chatId)); else voiceReplyChats.delete(String(message.chatId));
      setStatus({ voiceRepliesChats: voiceReplyChats.size });
      await sendMessage(token, message.chatId, enabled
        ? "Voice replies are ON for this chat. Text answers still arrive too."
        : "Voice replies are OFF for this chat.");
      return true;
    }
    return false;
  };

  const handleMessage = async (token: string, message: TelegramIncomingMessage): Promise<void> => {
    try {
      if (await handleCommand(token, message)) { setStatus({ handledMessages: status.handledMessages + 1 }); return; }
      let promptText = message.text;
      if (message.voiceFileId != null) {
        const audio = await downloadFile(token, message.voiceFileId);
        const transcript = await transcribeVoice(audio);
        if (transcript.length === 0) {
          await sendMessage(token, message.chatId, "I couldn't make out any words in that recording.");
          setStatus({ handledMessages: status.handledMessages + 1 });
          return;
        }
        if (promptText.length === 0) promptText = transcript;
        else promptText = `${promptText}\n\n(Voice transcript: ${transcript})`;
      }
      if (promptText.length === 0) {
        await sendMessage(token, message.chatId, "Send me a message or a voice note and I'll take it from there.");
        setStatus({ handledMessages: status.handledMessages + 1 });
        return;
      }
      const prompt = `A Telegram user named ${message.senderName} sends:\n\n${promptText}`;
      const reply = await deps.runTurn(prompt);
      await sendMessage(token, message.chatId, reply);
      if (voiceReplyChats.has(String(message.chatId))) {
        try {
          const speech = await synthesizeSpeech(reply);
          await sendVoiceNote(token, message.chatId, speech);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          setStatus({ lastError: `voice reply: ${detail}` });
        }
      }
      setStatus({ handledMessages: status.handledMessages + 1, lastError: null });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus({ lastError: detail });
      await sendMessage(token, message.chatId, `Router error: ${detail}`).catch(() => {});
    }
  };

  const pollLoop = async (generation: number, token: string): Promise<void> => {
    let backoffMs = 1_000;
    while (!stopped && generation === loopGeneration) {
      let messages: readonly TelegramIncomingMessage[] = [];
      try {
        const payload = await callApi(token, "getUpdates", {
          timeout: String(pollTimeoutSeconds),
          offset: String(offset),
          allowed_updates: JSON.stringify(["message"]),
        });
        messages = parseTelegramUpdateMessages(payload);
        backoffMs = 1_000;
        if (stopped || generation !== loopGeneration) return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setStatus({ running: !stopped && generation === loopGeneration, lastError: detail });
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 30_000);
        continue;
      }
      for (const message of messages) {
        offset = Math.max(offset, message.updateId + 1);
        await handleMessage(token, message);
        if (stopped || generation !== loopGeneration) return;
      }
      // Long polling usually blocks server-side; yield briefly between
      // immediate returns so the loop can never spin without yielding.
      await sleep(messages.length === 0 ? 200 : 25);
    }
  };

  return {
    async saveToken(raw: unknown): Promise<TelegramBotStatus> {
      const request = typeof raw === "object" && raw != null && !Array.isArray(raw) ? raw as { token?: unknown } : {};
      const token = normalizeSandTelegramBotToken(request.token);
      if (token == null) throw new Error("That does not look like a Telegram bot token. Get one from @BotFather (format: 123456789:AA…).");
      await deps.upsertSecret({ [TELEGRAM_BOT_SECRET_KEY]: token });
      setStatus({ configured: true, username: null });
      if (status.running) {
        this.stop();
        return await this.start();
      }
      return status;
    },

    async clearToken(): Promise<TelegramBotStatus> {
      this.stop();
      await deps.removeSecret([TELEGRAM_BOT_SECRET_KEY]);
      offset = 0;
      voiceReplyChats.clear();
      setStatus({ ...emptyTelegramBotStatus(), voiceGatewayUrl, configured: normalizeSandTelegramBotToken(deps.envToken) != null });
      return status;
    },

    getStatus(): TelegramBotStatus {
      return status;
    },

    async start(): Promise<TelegramBotStatus> {
      if (!stopped && status.running) return status;
      const token = await resolveToken();
      stopped = false;
      loopGeneration += 1;
      let username: string | null = null;
      try {
        const me = await callApi(token, "getMe");
        username = typeof (me.result as { username?: unknown } | null)?.username === "string" ? String((me.result as { username?: unknown }).username) : null;
      } catch (error) {
        stopped = true;
        const detail = error instanceof Error ? error.message : String(error);
        setStatus({ running: false, lastError: detail });
        throw error;
      }
      await probeSpeechReadiness();
      setStatus({ configured: true, running: true, username, startedAtMs: now(), lastError: null, deepgramConfigured, voiceRepliesChats: voiceReplyChats.size, voiceGatewayUrl });
      void pollLoop(loopGeneration, token).catch(() => {});
      return status;
    },

    stop(): TelegramBotStatus {
      stopped = true;
      loopGeneration += 1;
      setStatus({ running: false, startedAtMs: null });
      return status;
    },
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

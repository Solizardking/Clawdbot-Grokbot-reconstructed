import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = await mkdtemp(path.join(os.tmpdir(), "grok-telegram-tests-"));
test.after(async () => { await rm(scratchRoot, { recursive: true, force: true }); });

async function loadModule(relativePath) {
  const outfile = path.join(scratchRoot, `${relativePath.replace(/[^A-Za-z0-9._-]+/g, "__")}.mjs`);
  await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, relativePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile,
    logLevel: "silent",
  });
  return await import(`file://${outfile}`);
}

const VALID_TOKEN = "1234567890:AAFidmExampleTokenValue1234567890xyz";

function updateBatch(entries) {
  return {
    ok: true,
    result: entries.map(([updateId, chatId, text]) => ({
      update_id: updateId,
      message: { message_id: updateId, chat: { id: chatId, type: "private" }, from: { first_name: "Ada" }, text },
    })),
  };
}

function fakeTelegramApi({ batches }) {
  const calls = [];
  let queue = [...batches];
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    const method = parsed.pathname.split("/").pop();
    calls.push({ method, token: parsed.pathname.split("/")[1]?.replace(/^bot/, ""), query: Object.fromEntries(parsed.searchParams) });
    if (method === "getMe") return jsonResponse({ ok: true, result: { id: 1, username: "my_test_bot" } });
    if (method === "sendMessage") return jsonResponse({ ok: true, result: { message_id: 1 } });
    if (method === "getUpdates") {
      const batch = queue.shift();
      return jsonResponse(batch == null ? { ok: true, result: [] } : batch);
    }
    return jsonResponse({ ok: false, description: `unexpected method ${method}` });
  };
  return { fetchImpl, calls };
}

const jsonResponse = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

async function waitFor(condition, label = "condition", timeoutMs = 3_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (condition()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("telegram bot tokens normalize strictly and reject everything else", async () => {
  const contract = await loadModule("source/shared/telegram-bot.ts");
  assert.equal(contract.normalizeSandTelegramBotToken(`${VALID_TOKEN}`), VALID_TOKEN);
  assert.equal(contract.normalizeSandTelegramBotToken(`  ${VALID_TOKEN}  `), VALID_TOKEN);
  assert.equal(contract.normalizeSandTelegramBotToken("not-a-token"), undefined);
  assert.equal(contract.normalizeSandTelegramBotToken("1234567890"), undefined);
  assert.equal(contract.normalizeSandTelegramBotToken("1234567890:short"), undefined);
  assert.equal(contract.normalizeSandTelegramBotToken("abc:AAExampleTokenValue1234567890"), undefined);
  assert.equal(contract.normalizeSandTelegramBotToken(null), undefined);
  assert.equal(contract.normalizeSandTelegramBotToken(42), undefined);
  assert.equal(contract.TELEGRAM_BOT_SECRET_KEY, "TELEGRAM_BOT_TOKEN");
});

test("replies are clamped to the Telegram 4096-character limit", async () => {
  const contract = await loadModule("source/shared/telegram-bot.ts");
  assert.equal(contract.formatTelegramReply(" hello "), "hello");
  assert.equal(contract.formatTelegramReply(""), "(no reply)");
  const long = "x".repeat(5_000);
  const formatted = contract.formatTelegramReply(long);
  assert.equal(formatted.length, contract.TELEGRAM_MESSAGE_LIMIT);
  assert.ok(formatted.endsWith("…"));
});

test("commands parse with bot mentions and argument tails", async () => {
  const contract = await loadModule("source/shared/telegram-bot.ts");
  assert.deepEqual(contract.parseTelegramCommand("/start"), { command: "start", args: "" });
  assert.deepEqual(contract.parseTelegramCommand("/help@My_Other-Bot"), { command: "help", args: "" });
  assert.deepEqual(contract.parseTelegramCommand("/status   now please"), { command: "status", args: "now please" });
  assert.deepEqual(contract.parseTelegramCommand("/UPPER case"), { command: "upper", args: "case" });
  assert.equal(contract.parseTelegramCommand("hello there"), null);
  assert.equal(contract.parseTelegramCommand("/"), null);
});

test("raw getUpdates payloads project onto narrow incoming messages", async () => {
  const contract = await loadModule("source/shared/telegram-bot.ts");
  const messages = contract.parseTelegramUpdateMessages({
    ok: true,
    result: [
      { update_id: 7, message: { chat: { id: 42, type: "private" }, from: { first_name: "Ada", last_name: "L" }, text: " hi " } },
      { update_id: 8, message: { chat: { id: "@group", type: "group" }, from: { username: "bob" }, text: "yo" } },
      { update_id: 9, message: { chat: { id: 43 }, text: "" } },
      { update_id: 10, message: { chat: { id: 44 }, voice: { file_id: "VOICE1", duration: 2, mime_type: "audio/ogg" } } },
      { update_id: 11, message: { chat: { id: 45 }, audio: { file_id: "AUDIO2" }, caption: "check this" } },
      { update_id: 12, message: { chat: { id: 46 }, photo: [{ file_id: "NOPE" }] } },
      { update_id: 13 },
      { nonsense: true },
    ],
  });
  assert.equal(messages.length, 4);
  assert.deepEqual(messages[0], { updateId: 7, chatId: 42, chatType: "private", senderName: "Ada L", text: "hi", voiceFileId: null });
  assert.equal(messages[2].updateId, 10);
  assert.equal(messages[2].voiceFileId, "VOICE1");
  assert.equal(messages[3].voiceFileId, "AUDIO2");
  assert.equal(messages[3].text, "check this");
  assert.equal(contract.parseTelegramUpdateMessages({ ok: true }).length, 0);
});

test("deepgram and voice-gateway contracts normalize strictly", async () => {
  const contract = await loadModule("source/shared/telegram-bot.ts");
  assert.equal(contract.DEEPGRAM_SECRET_KEY, "DEEPGRAM_API_KEY");
  assert.equal(contract.normalizeSandDeepgramApiKey("a".repeat(24)), "a".repeat(24));
  assert.equal(contract.normalizeSandDeepgramApiKey("short"), undefined);
  assert.equal(contract.normalizeSandDeepgramApiKey("has space in it 1234567890"), undefined);
  assert.equal(contract.normalizeSandDeepgramSttModel(undefined), "nova-3");
  assert.equal(contract.normalizeSandDeepgramTtsModel("AURA-2-THALIA-EN"), "aura-2-thalia-en");
  assert.match(contract.deepgramSttUrl(), /api\.deepgram\.com\/v1\/listen\?model=nova-3&smart_format=true$/);
  assert.match(contract.deepgramSttUrl({ language: "en-US" }), /&language=en-US$/);
  assert.match(contract.deepgramTtsUrl(), /model=aura-2-thalia-en&encoding=opus&container=ogg$/);
  const gateway = contract.SAND_VOICE_GATEWAY_URL;
  assert.equal(gateway, "https://cheshire-clawd-livekit-grok-crimson-bush-9215.fly.dev");
  assert.equal(contract.normalizeSandVoiceGatewayUrl(`${gateway}/`), gateway);
  assert.equal(contract.normalizeSandVoiceGatewayUrl("http://insecure.example"), undefined);
  assert.match(contract.telegramFileUrl("TOK", "/vo/notes.oga"), /\/file\/botTOK\/vo\/notes\.oga$/);
});

test("deepgram transcripts parse out of prerecorded responses", async () => {
  const contract = await loadModule("source/shared/telegram-bot.ts");
  const payload = { results: { channels: [{ alternatives: [{ transcript: "  what is pumping?  " }] }] } };
  assert.equal(contract.parseDeepgramTranscript(payload), "what is pumping?");
  assert.equal(contract.parseDeepgramTranscript({ results: { channels: [{ alternatives: [{ transcript: "" }] }] } }), null);
  assert.equal(contract.parseDeepgramTranscript(null), null);
});

async function loadRuntime() {
  return await loadModule("source/electron-main/telegram/telegram-runtime.ts");
}

test("startup reports tokens from environment or saved secrets as configured", async () => {
  const runtime = await loadRuntime();
  for (const source of ["environment", "saved"]) {
    const api = fakeTelegramApi({ batches: [] });
    const service = runtime.createTelegramBotService({
      revealSecret: async key => source === "saved" && key === "TELEGRAM_BOT_TOKEN" ? VALID_TOKEN : null,
      envToken: source === "environment" ? VALID_TOKEN : undefined,
      upsertSecret: async () => {},
      removeSecret: async () => {},
      runTurn: async () => "",
      fetchImpl: api.fetchImpl,
    });
    try {
      const status = await service.start();
      assert.equal(status.running, true);
      assert.equal(status.configured, true, source);
    } finally {
      service.stop();
    }
  }
});

test("the bridge stores a BotFather token in the OS secret store and validates it", async () => {
  const runtime = await loadRuntime();
  const upserts = [];
  const service = runtime.createTelegramBotService({
    revealSecret: async () => null,
    upsertSecret: async entries => upserts.push(entries),
    removeSecret: async () => {},
    runTurn: async () => "",
  });
  await assert.rejects(service.saveToken({ token: "junk" }), /BotFather/);
  await service.saveToken({ token: VALID_TOKEN });
  assert.deepEqual(upserts, [{ TELEGRAM_BOT_TOKEN: VALID_TOKEN }]);
  assert.equal(service.getStatus().configured, true);
});

test("a user message flows through the routed turn and back as a reply", async () => {
  const runtime = await loadRuntime();
  const api = fakeTelegramApi({ batches: [updateBatch([[100, 42, "what is pumping?"]])] });
  let turnCount = 0;
  const service = runtime.createTelegramBotService({
    revealSecret: async () => VALID_TOKEN,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async prompt => { turnCount += 1; assert.match(prompt, /what is pumping\?/); return "Pepe Max just launched."; },
    fetchImpl: api.fetchImpl,
  });
  await service.start();
  assert.equal(service.getStatus().username, "my_test_bot");
  await waitFor(() => turnCount > 0 && api.calls.some(call => call.method === "sendMessage"));
  const sent = api.calls.filter(call => call.method === "sendMessage");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].query.chat_id, "42");
  assert.equal(sent[0].query.text, "Pepe Max just launched.");
  assert.equal(service.getStatus().handledMessages, 1);

  await waitFor(() => api.calls.filter(call => call.method === "getUpdates").some(call => call.query.offset === "101"));
  assert.equal(api.calls[api.calls.length - 1].method, "getUpdates");

  service.stop();
  assert.equal(service.getStatus().running, false);
});

test("built-in commands answer locally without burning an inference turn", async () => {
  const runtime = await loadRuntime();
  const api = fakeTelegramApi({ batches: [updateBatch([[200, 7, "/help"]]), updateBatch([[201, 7, "/start"]]), updateBatch([[202, 7, "/status"]])] });
  let turns = 0;
  const service = runtime.createTelegramBotService({
    revealSecret: async () => VALID_TOKEN,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async () => { turns += 1; return ""; },
    fetchImpl: api.fetchImpl,
  });
  await service.start();
  await waitFor(() => api.calls.filter(call => call.method === "sendMessage").length >= 3);
  assert.equal(turns, 0);
  const texts = api.calls.filter(call => call.method === "sendMessage").map(call => call.query.text);
  assert.match(texts[0], /Router provider/);
  assert.match(texts[1], /Router model \(OpenRouter by default\)/);
  assert.match(texts[2], /messages handled: 2/);
  assert.equal(service.getStatus().handledMessages, 3);
  service.stop();
});

test("turn failures surface as a friendly router error instead of silence", async () => {
  const runtime = await loadRuntime();
  const api = fakeTelegramApi({ batches: [updateBatch([[300, 9, "do a thing"]])] });
  const service = runtime.createTelegramBotService({
    revealSecret: async () => VALID_TOKEN,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async () => { throw new Error("OpenRouter needs OPENROUTER_API_KEY."); },
    fetchImpl: api.fetchImpl,
  });
  await service.start();
  await waitFor(() => api.calls.some(call => call.method === "sendMessage"));
  const sent = api.calls.find(call => call.method === "sendMessage");
  assert.match(sent.query.text, /Router error: OpenRouter needs OPENROUTER_API_KEY\./);
  assert.match(service.getStatus().lastError, /OPENROUTER_API_KEY/);
  service.stop();
});

function fakeVoiceApi({ deepgramKey = null, transcript = "what is pumping?", ttsAudio, openRouterKey = null, openRouterTtsAudio } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const href = String(url instanceof URL ? url : url?.url ?? url);
    calls.push({
      href: href.replace(/bot[^/]+\//, "bot…/"),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      ...(init?.body == null ? {} : { bodyText: typeof init.body === "string" ? init.body : Buffer.from(init.body).toString("latin1") }),
    });
    if (href.includes("/getMe")) return jsonResponse({ ok: true, result: { id: 1, username: "my_test_bot" } });
    if (href.includes("/getUpdates")) return jsonResponse({ ok: true, result: [] });
    if (href.includes("/sendMessage")) return jsonResponse({ ok: true, result: {} });
    if (href.includes("/sendVoice")) return jsonResponse({ ok: true, result: {} });
    if (href.includes("/getFile")) return jsonResponse({ ok: true, result: { file_path: "vo/notes.oga" } });
    if (href.includes("/file/bot")) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    if (href.includes("openrouter.ai/api/v1/audio/speech")) {
      if (openRouterTtsAudio == null) throw new Error("unexpected OpenRouter TTS call");
      assert.equal(init.headers.authorization, `Bearer ${openRouterKey}`);
      return new Response(new Uint8Array(openRouterTtsAudio), { status: 200, headers: { "content-type": "audio/mpeg", "x-generation-id": "gen-free-1" } });
    }
    if (href.includes("api.deepgram.com/v1/listen")) {
      if (deepgramKey == null) return new Response(JSON.stringify({ err_code: "invalid-credentials", err_msg: "bad key" }), { status: 401 });
      assert.equal(init.headers.authorization, `Token ${deepgramKey}`);
      return jsonResponse({ results: { channels: [{ alternatives: [{ transcript }] }] } });
    }
    if (href.includes("api.deepgram.com/v1/speak")) {
      if (ttsAudio == null) throw new Error("unexpected TTS call");
      assert.equal(init.headers.authorization, `Token ${deepgramKey}`);
      return new Response(new Uint8Array(ttsAudio), { status: 200, headers: { "content-type": "audio/ogg" } });
    }
    throw new Error(`fakeVoiceApi cannot handle ${href}`);
  };
  return { fetchImpl, calls };
}

test("a voice note is downloaded, transcribed by Deepgram, answered, and status reports STT readiness", async () => {
  const runtime = await loadRuntime();
  const deepgramKey = "dgkey_".repeat(4);
  const api = fakeVoiceApi({ deepgramKey });
  let turnPrompt = "";
  const voiceUpdate = {
    ok: true,
    result: [{ update_id: 500, message: { message_id: 5, chat: { id: 42, type: "private" }, from: { first_name: "Ada" }, voice: { file_id: "VOICE1", duration: 2 } } }],
  };
  let injected = false;
  const service = runtime.createTelegramBotService({
    revealSecret: async key => key === "TELEGRAM_BOT_TOKEN" ? VALID_TOKEN : deepgramKey,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async prompt => { turnPrompt = prompt; return "Pepe Max just launched."; },
    fetchImpl: async (url, init) => {
      if (!injected && String(url).includes("/getUpdates")) { injected = true; return jsonResponse(voiceUpdate); }
      return await api.fetchImpl(url, init);
    },
  });
  await service.start();
  assert.equal(service.getStatus().deepgramConfigured, true);
  await waitFor(() => api.calls.some(call => call.href.includes("/sendMessage")));
  assert.match(turnPrompt, /A Telegram user named Ada sends:\n\nwhat is pumping\?/);
  assert.equal(api.calls.filter(c => c.href.includes("/sendMessage")).length, 1);
  assert.ok(api.calls.some(c => c.href.includes("/getFile")));
  assert.ok(api.calls.some(c => c.href.includes("/file/bot")));
  assert.ok(api.calls.some(c => c.href.includes("api.deepgram.com/v1/listen")));
  assert.equal(service.getStatus().handledMessages, 1);
  service.stop();
});

test("/voice turns on spoken replies and answers arrive as Deepgram Aura OGG voice notes", async () => {
  const runtime = await loadRuntime();
  const deepgramKey = "d".repeat(30);
  const api = fakeVoiceApi({ deepgramKey, ttsAudio: [79, 103, 103, 83] });
  const batches = [updateBatch([[600, 77, "/voice"]]), updateBatch([[601, 77, "say hi"]])];
  const service = runtime.createTelegramBotService({
    revealSecret: async key => key === "TELEGRAM_BOT_TOKEN" ? VALID_TOKEN : deepgramKey,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async () => "Hi Ada!",
    fetchImpl: async (url, init) => {
      if (String(url).includes("/getUpdates")) {
        const batch = batches.shift();
        return jsonResponse(batch == null ? { ok: true, result: [] } : batch);
      }
      return await api.fetchImpl(url, init);
    },
  });
  await service.start();
  await waitFor(() => service.getStatus().voiceRepliesChats === 1 && api.calls.some(c => c.href.includes("/sendVoice")));
  assert.equal(service.getStatus().handledMessages, 2);
  const voiceCall = api.calls.find(c => c.href.includes("/sendVoice"));
  assert.match(voiceCall.headers["content-type"], /^multipart\/form-data; boundary=sandvoice/);
  service.stop();
});

test("/voice speaks through free OpenRouter TTS when only OPENROUTER_API_KEY and OPENROUTER_VOICE are set", async () => {
  const runtime = await loadRuntime();
  const openRouterKey = "sk-or-v1-free-voice";
  const api = fakeVoiceApi({ deepgramKey: null, openRouterKey, openRouterTtsAudio: [73, 68, 51, 3] });
  const batches = [updateBatch([[800, 91, "/voice"]]), updateBatch([[801, 91, "say hi"]])];
  const service = runtime.createTelegramBotService({
    revealSecret: async key => key === "TELEGRAM_BOT_TOKEN" ? VALID_TOKEN : null,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async () => "Hi Ada!",
    envOpenRouterKey: openRouterKey,
    envVoiceModel: "deepgram/flux-tts:free",
    fetchImpl: async (url, init) => {
      if (String(url).includes("/getUpdates")) {
        const batch = batches.shift();
        return jsonResponse(batch == null ? { ok: true, result: [] } : batch);
      }
      return await api.fetchImpl(url, init);
    },
  });
  await service.start();
  assert.equal(service.getStatus().deepgramConfigured, false);
  await waitFor(() => service.getStatus().voiceRepliesChats === 1 && api.calls.some(c => c.href.includes("/sendVoice")));
  assert.equal(service.getStatus().handledMessages, 2);
  const ttsCall = api.calls.find(c => c.href.includes("openrouter.ai/api/v1/audio/speech"));
  assert.ok(ttsCall != null, "OpenRouter /audio/speech must be called");
  assert.deepEqual(JSON.parse(ttsCall.bodyText), { model: "deepgram/flux-tts:free", input: "Hi Ada!", voice: "flux-alexis-en", response_format: "mp3" });
  const voiceCall = api.calls.find(c => c.href.includes("/sendVoice"));
  assert.match(voiceCall.headers["content-type"], /^multipart\/form-data; boundary=sandvoice/);
  assert.match(voiceCall.bodyText ?? "", /filename="reply\.mp3"/);
  service.stop();
});

test("an OpenRouter key alone falls back to the default free TTS model for spoken replies", async () => {
  const runtime = await loadRuntime();
  const openRouterKey = "sk-or-v1-free-voice";
  const api = fakeVoiceApi({ deepgramKey: null, openRouterKey, openRouterTtsAudio: [73, 68, 51, 3] });
  const batches = [updateBatch([[900, 92, "/voice on"]]), updateBatch([[901, 92, "say hi"]])];
  const service = runtime.createTelegramBotService({
    revealSecret: async key => key === "TELEGRAM_BOT_TOKEN" ? VALID_TOKEN : null,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async () => "Free voice!",
    envOpenRouterKey: openRouterKey,
    fetchImpl: async (url, init) => {
      if (String(url).includes("/getUpdates")) {
        const batch = batches.shift();
        return jsonResponse(batch == null ? { ok: true, result: [] } : batch);
      }
      return await api.fetchImpl(url, init);
    },
  });
  await service.start();
  await waitFor(() => service.getStatus().voiceRepliesChats === 1 && api.calls.some(c => c.href.includes("/sendVoice")));
  const ttsCall = api.calls.find(c => c.href.includes("openrouter.ai/api/v1/audio/speech"));
  assert.ok(ttsCall != null, "OpenRouter fallback TTS must be called");
  assert.equal(JSON.parse(ttsCall.bodyText).model, "deepgram/flux-tts:free");
  service.stop();
});

test("a voice note without DEEPGRAM_API_KEY gets actionable guidance instead of silence", async () => {
  const runtime = await loadRuntime();
  const api = fakeVoiceApi({ deepgramKey: null });
  const voiceUpdate = {
    ok: true,
    result: [{ update_id: 700, message: { chat: { id: 9 }, from: { first_name: "Ada" }, voice: { file_id: "V2" } } }],
  };
  let injected = false;
  const service = runtime.createTelegramBotService({
    revealSecret: async key => key === "TELEGRAM_BOT_TOKEN" ? VALID_TOKEN : null,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async () => "",
    fetchImpl: async (url, init) => {
      if (!injected && String(url).includes("/getUpdates")) { injected = true; return jsonResponse(voiceUpdate); }
      return await api.fetchImpl(url, init);
    },
  });
  await service.start();
  assert.equal(service.getStatus().deepgramConfigured, false);
  await waitFor(() => api.calls.some(c => c.href.includes("/sendMessage")));
  const sent = api.calls.find(c => c.href.includes("/sendMessage"));
  assert.match(new URL(sent.href).searchParams.get("text") ?? "", /DEEPGRAM_API_KEY/);
  service.stop();
});

test("clearing the token stops the poller and forgets the secret", async () => {
  const runtime = await loadRuntime();
  const removed = [];
  const service = runtime.createTelegramBotService({
    revealSecret: async () => VALID_TOKEN,
    upsertSecret: async () => {},
    removeSecret: async keys => removed.push(...keys),
    runTurn: async () => "",
    fetchImpl: fakeTelegramApi({ batches: [] }).fetchImpl,
  });
  await service.start();
  assert.equal(service.getStatus().running, true);
  await service.clearToken();
  assert.deepEqual(removed, ["TELEGRAM_BOT_TOKEN"]);
  assert.equal(service.getStatus().configured, false);
  assert.equal(service.getStatus().running, false);
});

test("starting without any saved token fails with actionable guidance", async () => {
  const runtime = await loadRuntime();
  const service = runtime.createTelegramBotService({
    revealSecret: async () => null,
    upsertSecret: async () => {},
    removeSecret: async () => {},
    runTurn: async () => "",
    fetchImpl: fakeTelegramApi({ batches: [] }).fetchImpl,
  });
  await assert.rejects(service.start(), /@BotFather/);
  assert.equal(service.getStatus().running, false);
});

test("read-only solana tools summarize Helius payloads and reject junk input", async () => {
  const tools = await loadModule("source/electron-main/solana/solana-routed-tools.ts");
  assert.equal(tools.SOLANA_ROUTED_TOOLS.every(tool => tool.providerIdentifier === "grok-bot-local-solana"), true);
  assert.equal(tools.isSolanaRoutedTool("solana_wallet_assets"), true);
  assert.equal(tools.isSolanaRoutedTool("solana_reveal_local_wallet_secret"), false);

  const port = {
    listWallets: async () => ({ wallets: [{ name: "Main", solanaAddress: "So11111111111111111111111111111111111111112" }] }),
    listLocalWallets: async () => ({ wallets: [{ name: "Burner", address: "4Nd1mBQtrMJVYDfZSbM9ThKHm6YiRzL9isG6m3TqLq1i" }] }),
    getWalletAssets: async () => ({
      total: 2,
      items: [
        { id: "mint-1", content: { metadata: { symbol: "BONK", name: "Bonk" } }, token_info: { balance: 1_000_000, decimals: 5 } },
        { id: "mint-2", content: { metadata: { symbol: "WIF", name: "dogwifhat" } }, token_info: { balance: 3, decimals: 6 } },
      ],
      nativeBalance: { lamports: 2_000_000_000 },
    }),
    getAsset: async () => ({ id: "mint-1" }),
    searchAssets: async request => ({ total: 0, items: [], echoed: request.tokenType }),
  };
  const listed = await tools.executeSolanaRoutedTool(port, "solana_list_wallets", {});
  assert.equal(listed.count, 2);
  assert.deepEqual(listed.wallets.map(row => row.name), ["Main", "Burner"]);

  const assets = await tools.executeSolanaRoutedTool(port, "solana_wallet_assets", { owner_address: "So11111111111111111111111111111111111111112" });
  assert.equal(assets.assets.items[0].symbol, "BONK");
  assert.equal(assets.assets.nativeBalanceSol, 2);

  await assert.rejects(tools.executeSolanaRoutedTool(port, "solana_wallet_assets", {}), /owner_address/);
  await assert.rejects(tools.executeSolanaRoutedTool(port, "solana_asset_get", { asset_id: "nope" }), /asset_id/);
  await assert.rejects(tools.executeSolanaRoutedTool(port, "solana_nope", {}), /Unknown Solana routed tool/);
});

test("the whole capability is wired across rpc table, main edge, preload, and production services", async () => {
  const rpcTable = await readFile(path.join(repoRoot, "source/shared/rpc/main.ts"), "utf8");
  for (const method of ["telegramGetStatus", "telegramSaveToken", "telegramClearToken", "telegramStart", "telegramStop"]) {
    assert.match(rpcTable, new RegExp(`${method}: \\{ args: `), `${method} must be declared in MAIN_METHOD_TABLE`);
  }
  const mainEdge = await readFile(path.join(repoRoot, "source/electron-main/main-edge.ts"), "utf8");
  assert.match(mainEdge, /readonly telegram: UnknownRecord;/);
  assert.match(mainEdge, /telegramGetStatus: \(\) => invoke\(deps\.telegram, "getStatus"\)/);
  assert.match(mainEdge, /telegramSaveToken: \(raw\) => invoke\(deps\.telegram, "saveToken", req\(raw\)\)/);
  const mainRpc = await readFile(path.join(repoRoot, "source/electron-main/adapters/main-rpc.ts"), "utf8");
  assert.match(mainRpc, /\| "telegram"/);
  assert.match(mainRpc, /mainRpc\.telegram/);
  const services = await readFile(path.join(repoRoot, "source/electron-main/main-production-services.ts"), "utf8");
  assert.match(services, /createTelegramBotService\(/);
  assert.match(services, /env\.TELEGRAM_BOT_TOKEN/);
  assert.match(services, /envDeepgramKey: env\.DEEPGRAM_API_KEY/);
  assert.match(services, /voiceGatewayUrl: env\.SAND_VOICE_GATEWAY_URL/);
  assert.match(services, /executeSolanaRoutedTool\(solanaServiceMerged/);
  assert.match(services, /executePumpRoutedTool\(definition\.name/);
  assert.match(services, /readonly telegram: unknown;/);
  const preload = await readFile(path.join(repoRoot, "source/electron-preload/preload.ts"), "utf8");
  assert.match(preload, /saveToken: \(token: string\) => edge\("telegramSaveToken", \{ token \}\)/);
  // The standalone Clawd tree imports the runtime contracts, not the parent
  // reconstruction's ASAR renderer patch. Its Telegram deployment is headless.
});

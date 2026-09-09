import http from "node:http";
import { pathToFileURL } from "node:url";
import { resolveOpenRouterModelChain } from "../../shared/inference-router.js";
import { createOpenRouterModelFetch } from "../../shared/openrouter-model-fetch.js";
import { PAYBOX_INSTRUCTIONS } from "../../shared/paybox-instructions.js";
import { BUNDLED_SKILL_ROUTED_TOOLS, executeBundledSkillTool, isBundledSkillTool, renderBundledSkillsCatalog } from "../../shared/bundled-trading-skills.js";
import { executePayboxRoutedTool, isPayboxRoutedTool, payboxRoutedTools } from "../../node-agent-coordinator/paybox-tools.js";

import { createTelegramBotService } from "../../electron-main/telegram/telegram-runtime.js";
import {
  executeWebRoutedTool,
  isWebRoutedTool,
  webRoutedTools,
} from "../../node-agent-coordinator/web-tools.js";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const MAX_TOOL_STEPS = 8;
const TOOL_RESULT_CHAR_LIMIT = 60_000;
const SUPERVISOR_RETRY_MS = 15_000;

/** OpenRouter app attribution: keeps usage ranked under solanaclawd.com. */
function envReferer(): string | null {
  const value = process.env.SAND_OPENROUTER_REFERER?.trim();
  return value != null && value.length > 0 ? value : null;
}
function envTitle(): string | null {
  const value = process.env.SAND_OPENROUTER_TITLE?.trim();
  return value != null && value.length > 0 ? value : null;
}
function envCategories(): string | null {
  const value = process.env.SAND_OPENROUTER_CATEGORIES?.trim();
  return value != null && value.length > 0 ? value : null;
}

const ROUTED_SYSTEM_PROMPT = [
  "You are Clawd Bot, a warm, concise desktop assistant.",
  "You are running inside Clawd Bot, not inside Codex CLI or Claude Code.",
  "The tools supplied with this request are Clawd Bot's already-connected plugins and accounts. Use them whenever they are relevant instead of claiming that a plugin is unavailable or asking the user to reconnect it.",
  "Never ask for an API key for an already-connected plugin. Respond directly to the user in natural language after completing any necessary tool calls.",
].join("\n");

export type HeadlessProvider = "openrouter" | "xai";

export interface HeadlessTurnRunnerDeps {
  readonly provider?: HeadlessProvider | undefined;
  readonly apiKey?: string | undefined;
  readonly models?: readonly string[] | undefined;
  readonly fetchImpl?: typeof fetch;
}

interface ToolCallShape {
  readonly id?: unknown;
  readonly function?: { readonly name?: unknown; readonly arguments?: unknown };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: readonly unknown[];
  tool_call_id?: string;
}

interface ChatCompletionPayload {
  choices?: readonly { message?: { content?: unknown; tool_calls?: unknown } }[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveHeadlessProvider(env: NodeJS.ProcessEnv = process.env): HeadlessProvider {
  const requested = env.TELEGRAM_ROUTER_PROVIDER?.trim().toLowerCase();
  if (requested === "xai") return "xai";
  if (requested === "openrouter") return "openrouter";
  const hasXai = (env.XAI_API_KEY?.trim().length ?? 0) > 0;
  const hasOpenRouter = (env.OPENROUTER_API_KEY?.trim().length ?? 0) > 0;
  return hasXai && !hasOpenRouter ? "xai" : "openrouter";
}

export function resolveHeadlessModel(provider: HeadlessProvider, env: NodeJS.ProcessEnv = process.env): string {
  if (provider === "xai") return env.SAND_XAI_MODEL?.trim() || "grok-4.6";
  return resolveOpenRouterModelChain(env)[0]!;
}

export function resolveHeadlessModelChain(provider: HeadlessProvider, env: NodeJS.ProcessEnv = process.env): string[] {
  if (provider === "openrouter") return resolveOpenRouterModelChain(env);
  const chain = [resolveHeadlessModel(provider, env)];
  const fallbackList = env.SAND_XAI_FALLBACK_MODELS;
  for (const raw of fallbackList?.split(",") ?? []) {
    const candidate = raw.trim();
    if (candidate.length > 0 && !chain.includes(candidate)) chain.push(candidate);
  }
  return chain;
}

export function createHeadlessTurnRunner(deps: HeadlessTurnRunnerDeps = {}): (prompt: string) => Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const run = async (prompt: string): Promise<string> => {
    const provider = deps.provider ?? resolveHeadlessProvider();
    const apiKey = deps.apiKey ?? (provider === "xai" ? process.env.XAI_API_KEY : process.env.OPENROUTER_API_KEY)?.trim() ?? "";
    const models = deps.models ?? resolveHeadlessModelChain(provider);
    if (apiKey.length === 0) {
      throw new Error(`${provider === "xai" ? "xAI needs XAI_API_KEY" : "OpenRouter needs OPENROUTER_API_KEY"}; set it with \`fly secrets set\`.`);
    }
    if (models.length === 0) throw new Error("No inference models configured.");
    if (provider === "openrouter") return runSingleModelTurn(provider, apiKey, models[0]!, prompt, createOpenRouterModelFetch(fetchImpl, models));
    let lastError: Error | null = null;
    for (const model of models) {
      try {
        return await runSingleModelTurn(provider, apiKey, model, prompt, fetchImpl);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error("The router failed without a specific error.");
  };
  return run;
}

async function runSingleModelTurn(provider: HeadlessProvider, apiKey: string, model: string, prompt: string, fetchImpl: typeof fetch): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${ROUTED_SYSTEM_PROMPT}\n\n${PAYBOX_INSTRUCTIONS}\n\n${renderBundledSkillsCatalog()}` },
    { role: "user", content: prompt },
  ];
  const tools = [...BUNDLED_SKILL_ROUTED_TOOLS, ...webRoutedTools(), ...await payboxRoutedTools()].map(toolDefinition => ({
    type: "function",
    function: {
      name: toolDefinition.name,
      description: toolDefinition.description,
      parameters: toolDefinition.inputSchema,
    },
  }));
  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const response = await fetchImpl(provider === "xai" ? XAI_CHAT_URL : OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(provider === "xai" ? {} : {
          "HTTP-Referer": envReferer() || "https://solanaclawd.com",
          "X-OpenRouter-Title": envTitle() || "SolanaClawd",
          "X-OpenRouter-Categories": envCategories() || "personal-agent,general-chat",
          ...(envTitle() == null ? { "X-Title": "SolanaClawd" } : {}),
        }),
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
    });
    const payload = await response.json().catch(() => null) as ChatCompletionPayload | null;
    if (!response.ok) {
      const detail = payload != null && typeof payload === "object"
        ? JSON.stringify(payload).slice(0, 300)
        : `HTTP ${response.status}`;
      throw new Error(`The ${provider} chat request failed (${detail}).`);
    }
    const choice = payload?.choices?.[0]?.message;
    const rawCalls = Array.isArray(choice?.tool_calls) ? choice!.tool_calls as readonly ToolCallShape[] : [];
    if (rawCalls.length > 0) {
      messages.push({ role: "assistant", content: typeof choice?.content === "string" ? choice.content : "", tool_calls: rawCalls });
      for (const call of rawCalls) {
        const name = typeof call.function?.name === "string" ? call.function.name : "";
        let result: unknown;
        try {
          const argsText = typeof call.function?.arguments === "string" && call.function.arguments.length > 0 ? call.function.arguments : "{}";
          result = isBundledSkillTool(name) ? executeBundledSkillTool(name, JSON.parse(argsText)) : isPayboxRoutedTool(name) ? await executePayboxRoutedTool(name, JSON.parse(argsText)) : isWebRoutedTool(name)
            ? await executeWebRoutedTool(name, JSON.parse(argsText))
            : { ok: false, error: `No headless tool named "${name}".` };
        } catch (error) {
          result = { ok: false, error: errorText(error) };
        }
        messages.push({
          role: "tool",
          ...(typeof call.id === "string" ? { tool_call_id: call.id } : {}),
          content: JSON.stringify(result).slice(0, TOOL_RESULT_CHAR_LIMIT),
        });
      }
      continue;
    }
    const text = typeof choice?.content === "string" ? choice.content.trim() : "";
    if (text.length === 0) throw new Error("The router returned an empty reply.");
    return text;
  }
  throw new Error(`The router exceeded ${MAX_TOOL_STEPS} tool steps without answering.`);
}

const log = (...parts: readonly unknown[]): void => {
  console.log("[grok-telegram-fly]", ...parts);
};

async function waitFor(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  const telegramService = createTelegramBotService({
    revealSecret: async key => process.env[key]?.trim() || null,
    upsertSecret: async () => { throw new Error("Secret storage is read-only on Fly; use `fly secrets set` instead."); },
    removeSecret: async () => { throw new Error("Secret storage is read-only on Fly; use `fly secrets unset` instead."); },
    runTurn: createHeadlessTurnRunner(),
    envToken: process.env.TELEGRAM_BOT_TOKEN,
    envDeepgramKey: process.env.DEEPGRAM_API_KEY,
    envOpenRouterKey: process.env.OPENROUTER_API_KEY,
    envVoiceModel: process.env.OPENROUTER_VOICE,
    voiceGatewayUrl: process.env.SAND_VOICE_GATEWAY_URL,
    onStatus: status => log("status:", JSON.stringify(status)),
  });

  const httpServer = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", `http://localhost:${port}`).pathname;
    if (pathname === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (pathname === "/status") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(telegramService.getStatus()));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
  });
  await new Promise<void>(resolve => httpServer.listen(port, () => resolve()));
  log(`health server listening on port ${port}`);

  let shuttingDown = false;
  const startOnceRunning = async (): Promise<void> => {
    while (!shuttingDown && !telegramService.getStatus().running) {
      try {
        await telegramService.start();
        return;
      } catch (error) {
        log("start failed:", errorText(error), `- retrying in ${SUPERVISOR_RETRY_MS / 1000}s`);
        await waitFor(SUPERVISOR_RETRY_MS);
      }
    }
  };
  void startOnceRunning();

  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    telegramService.stop();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const invokedDirectly = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error("[grok-telegram-fly] fatal:", errorText(error));
    process.exit(1);
  });
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { executePayboxRoutedTool, isPayboxRoutedTool, payboxRoutedTools } from "../node-agent-coordinator/paybox-tools.js";

import { createSolanaService } from "../electron-main/solana/solana-service.js";
import { SOLANA_ROUTED_TOOLS, executeSolanaRoutedTool, isSolanaRoutedTool } from "../electron-main/solana/solana-routed-tools.js";
import { createTelegramBotService } from "../electron-main/telegram/telegram-runtime.js";
import { runRoutedProviderText } from "../host/extensions/inference/provider-session.js";
import { executePumpRoutedTool, isPumpRoutedTool, pumpRoutedTools, stopPumpTape } from "../node-agent-coordinator/pump-tape.js";
import { executeSolanaTradingRoutedTool, isSolanaTradingRoutedTool, SOLANA_TRADING_ROUTED_TOOLS } from "../node-agent-coordinator/solana-trading-tools.js";
import { SOLANA_AGENT_ROUTED_TOOLS, createDefaultSolanaAgentPort, executeSolanaAgentRoutedTool, isSolanaAgentRoutedTool } from "../node-agent-coordinator/solana-agent-tools.js";
import { clawdGatewayRoutedTools, createDefaultClawdGatewayPort, executeClawdGatewayRoutedTool, isClawdGatewayRoutedTool } from "../node-agent-coordinator/clawd-gateway-tools.js";
import { injectSolanaBotEnv } from "../shared/solana-bot-env.js";
import {
  DEEPGRAM_SECRET_KEY,
  TELEGRAM_BOT_SECRET_KEY,
  normalizeSandVoiceGatewayUrl,
} from "../shared/telegram-bot.js";

export interface TelegramBridgeEnvConfig {
  readonly token: string | null;
  readonly deepgramConfigured: boolean;
  readonly heliusConfigured: boolean;
  readonly openRouterConfigured: boolean;
  /** Explicit gateway override; null means "use the built-in default". */
  readonly voiceGatewayUrl: string | null;
  readonly autoStart: boolean;
  readonly port: number;
}

function firstSecret(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Normalizes the headless deployment configuration from raw process env. */
export function resolveBridgeEnvConfig(env: NodeJS.ProcessEnv): TelegramBridgeEnvConfig {
  const port = env.PORT?.trim() ? Number(env.PORT) : NaN;
  return {
    token: firstSecret(env, TELEGRAM_BOT_SECRET_KEY),
    deepgramConfigured: firstSecret(env, DEEPGRAM_SECRET_KEY) != null,
    heliusConfigured: firstSecret(env, "HELIUS_API_KEY") != null || firstSecret(env, "HELIUS_RPC_URL") != null,
    openRouterConfigured: firstSecret(env, "OPENROUTER_API_KEY") != null,
    voiceGatewayUrl: normalizeSandVoiceGatewayUrl(env.SAND_VOICE_GATEWAY_URL) ?? null,
    autoStart: env.SAND_TELEGRAM_AUTOSTART !== "0",
    port: Number.isSafeInteger(port) && port >= 0 && port <= 65535 ? port : 8080,
  };
}

export interface TelegramBridgeServerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

export interface TelegramBridgeServer {
  readonly config: TelegramBridgeEnvConfig;
  readonly bot: ReturnType<typeof createTelegramBotService>;
  /** Binds the health HTTP listener; resolves with the actual bound port. */
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function createTelegramBridgeServer(options?: TelegramBridgeServerOptions): TelegramBridgeServer {
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const config = resolveBridgeEnvConfig(env);

  // Read-only Solana surface backed purely by env secrets; wallet creation is
  // intentionally unavailable on the hosted bridge.
  let walletsMemory: unknown = { schemaVersion: 1, wallets: [] };
  const solana = createSolanaService({
    revealSecret: async (key) => firstSecret(env, key),
    readRegistry: async () => walletsMemory,
    writeRegistry: async (value) => { walletsMemory = value; },
    loadServerSdk: async () => { throw new Error("Phantom wallet creation is not available on the hosted Telegram bridge."); },
    ...(options?.fetchImpl == null ? {} : { fetchImpl }),
    envHeliusKey: env.HELIUS_API_KEY,
    envHeliusRpcUrl: env.HELIUS_RPC_URL,
  });

  // Fill HELIUS_RPC_URL / HELIUS_API_KEY / JUPITER_API_KEY gaps from secrets;
  // derive HELIUS_RPC_URL from the Helius key when it is not explicit.
  void injectSolanaBotEnv({
    env,
    revealSecret: async (key) => firstSecret(env, key),
  }).catch(() => {});
  const runTurn = async (prompt: string): Promise<string> => {
    return await runRoutedProviderText("openrouter", [{ role: "user", content: prompt }], {
      tools: [...pumpRoutedTools(), ...SOLANA_ROUTED_TOOLS, ...SOLANA_TRADING_ROUTED_TOOLS, ...SOLANA_AGENT_ROUTED_TOOLS, ...clawdGatewayRoutedTools(env), ...await payboxRoutedTools()],
      executeTool: async (definition, toolArgs) => {
        if (isPayboxRoutedTool(definition.name)) return executePayboxRoutedTool(definition.name, toolArgs);
        if (isSolanaRoutedTool(definition.name)) return await executeSolanaRoutedTool(solana, definition.name, toolArgs);
        if (isSolanaTradingRoutedTool(definition.name)) {
          return await executeSolanaTradingRoutedTool({
            fetchImpl,
            heliusRpcUrl: async () => {
              const resolved = await injectSolanaBotEnv({ env, revealSecret: async (key) => firstSecret(env, key) });
              if (resolved.HELIUS_RPC_URL != null) return resolved.HELIUS_RPC_URL;
              throw new Error("Helius is not configured. Set HELIUS_RPC_URL or HELIUS_API_KEY (fly secrets set).");
            },
            jupiterApiKey: async () => firstSecret(env, "JUPITER_API_KEY"),
          }, definition.name, toolArgs);
        }
        if (isSolanaAgentRoutedTool(definition.name)) {
          return await executeSolanaAgentRoutedTool(createDefaultSolanaAgentPort({ fetchImpl }), definition.name, toolArgs);
        }
        if (isClawdGatewayRoutedTool(definition.name)) {
          return await executeClawdGatewayRoutedTool(createDefaultClawdGatewayPort({ fetchImpl, env }), definition.name, toolArgs);
        }
        if (isPumpRoutedTool(definition.name)) return await executePumpRoutedTool(definition.name, toolArgs);
        throw new Error(`The hosted bridge has no local tool named ${String(definition.name)}.`);
      },
    });
  };

  let latestStatus: unknown = null;
  const bot = createTelegramBotService({
    revealSecret: async (key) => firstSecret(env, key),
    upsertSecret: async () => { throw new Error("The hosted bridge reads its secrets from machine environment only."); },
    removeSecret: async () => { throw new Error("The hosted bridge reads its secrets from machine environment only."); },
    envToken: config.token ?? undefined,
    envDeepgramKey: env.DEEPGRAM_API_KEY,
    envOpenRouterKey: env.OPENROUTER_API_KEY,
    envVoiceModel: env.OPENROUTER_VOICE,
    voiceGatewayUrl: config.voiceGatewayUrl ?? undefined,
    runTurn,
    ...(options?.fetchImpl == null ? {} : { fetchImpl }),
    onStatus: (status) => { latestStatus = status; },
  });

  const connections = new Set<Socket>();
  const httpServer = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = (request.url ?? "/").replace(/\?.*$/, "");
    if (request.method === "GET" && url === "/") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("OK");
      return;
    }
    if (request.method === "GET" && url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: true, bot: latestStatus, config: { ...config, token: config.token != null ? "configured" : null } }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404: Not Found");
  });
  httpServer.on("connection", (socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
  });

  return {
    config,
    bot,
    listen: async () => await new Promise<number>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      httpServer.once("error", onError);
      httpServer.listen(config.port, "0.0.0.0", () => {
        const address = httpServer.address();
        httpServer.off("error", onError);
        resolve(typeof address === "object" && address != null ? address.port : config.port);
      });
    }),
    close: async () => {
      bot.stop();
      for (const connection of connections) connection.destroy();
      await new Promise<void>((resolve) => { httpServer.close(() => resolve()); });
    },
  };
}

/** Docker/fly entrypoint: bind health first, then go live. */
export async function runTelegramBridgeEntrypoint(options?: TelegramBridgeServerOptions): Promise<void> {
  const server = createTelegramBridgeServer(options);
  const port = await server.listen();
  const shutdown = async () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    stopPumpTape();
    await server.close();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.stdout.write(`telegram-bridge: health listening on :${port}\n`);
  if (server.config.autoStart) {
    try {
      const status = await server.bot.start();
      process.stdout.write(`telegram-bridge: polling live as @${status.username ?? "unknown"}\n`);
    } catch (error) {
      process.stderr.write(`telegram-bridge: autostart failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  } else {
    process.stdout.write("telegram-bridge: autostart disabled (SAND_TELEGRAM_AUTOSTART=0)\n");
  }
}

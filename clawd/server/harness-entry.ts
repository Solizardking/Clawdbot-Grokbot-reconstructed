// Production-adapted harness server for this repo's npm/Node toolchain.
// Boots without Electron, CUA, or the full driver registry. Solana status,
// local wallets, and routed tools are the real shipped modules.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import { connectConnector, CONNECTOR_IDS, listConnectorStatuses, secretsFromEnv, type ConnectorId } from "../shared/connectors.ts";
import { PRODUCT_ID, PRODUCT_NAME } from "../shared/product.ts";
import { createLocalSolanaWalletStore } from "./solana/local-wallets.ts";
import { createPumpTapeStore, parsePumpMessage } from "./solana/pump-tape.ts";
import {
  executeSolanaRoutedTool,
  isSolanaRoutedTool,
  SOLANA_ROUTED_TOOLS,
} from "./solana/solana-routed-tools.ts";
import { createSolanaService } from "./solana/solana-service.ts";

const PORT = Number(process.env.CLAWD_PORT || process.env.OMB_PORT || process.env.OGB_PORT || 8799);

function dataDir(): string {
  return process.env.CLAWD_DATA_DIR || process.env.OMB_DATA_DIR || join(homedir(), ".clawdbot");
}

const connectorSecrets = () => secretsFromEnv(process.env);

function createRuntime() {
  const registry = { schemaVersion: 1, wallets: [] as unknown[] };
  const solana = createSolanaService({
    envRpcUrl: process.env.SOLANA_TRACKER_RPC_URL || process.env.SOLANA_RPC_URL || process.env.RPC_URL || process.env.HELIUS_RPC_URL,
    revealSecret: async () => null,
    readRegistry: async () => registry,
    writeRegistry: async (value) => {
      const next = value as { wallets?: unknown[] };
      registry.wallets = Array.isArray(next.wallets) ? next.wallets : [];
    },
    loadServerSdk: async () => ({
      ServerSDK: class {
        async createWallet() {
          throw new Error("Phantom is not configured in the production harness.");
        }
      },
    }),
  });
  const tapeStore = createPumpTapeStore();
  const localWallets = createLocalSolanaWalletStore({
    storePath: join(dataDir(), "solana-wallets.json"),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plainText) => Buffer.from(plainText, "utf8"),
      decryptString: (encrypted) => encrypted.toString("utf8"),
    },
    randomSeed: () => randomBytes(32),
  });
  const solanaPort = {
    listWallets: () => solana.listWallets(),
    getWalletAssets: (raw: unknown) => solana.getWalletAssets(raw),
    getAsset: (raw: unknown) => solana.getAsset(raw),
    searchAssets: (raw: unknown) => solana.searchAssets(raw),
    listLocalWallets: () => localWallets.listLocalWallets(),
    revealLocalWalletSecret: (raw: unknown) => localWallets.revealLocalWalletSecret(raw),
    generateLocalWallet: (raw: unknown) => localWallets.generateLocalWallet(raw),
  };
  return { solana, tapeStore, localWallets, solanaPort };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return {};
  }
}

export function createHarnessServer() {
  const { solana, tapeStore, localWallets, solanaPort } = createRuntime();
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const method = req.method ?? "GET";
    try {
      if (method === "GET" && url.pathname === "/api/health") {
        const status = await solana.getStatus();
        const wallets = await localWallets.listLocalWallets();
        return json(res, 200, {
          app: PRODUCT_ID,
          name: PRODUCT_NAME,
          pid: process.pid,
          solana: status,
          connectors: listConnectorStatuses(connectorSecrets()),
          tape: tapeStore.snapshot(),
          wallets,
        });
      }
      if (method === "GET" && url.pathname === "/api/connectors") {
        return json(res, 200, { connectors: listConnectorStatuses(connectorSecrets()) });
      }
      const connectMatch = url.pathname.match(/^\/api\/connectors\/([A-Za-z0-9_]+)\/connect$/);
      if (method === "POST" && connectMatch && CONNECTOR_IDS.includes(connectMatch[1] as ConnectorId)) {
        return json(res, 200, connectConnector(connectMatch[1] as ConnectorId, connectorSecrets()));
      }
      if (method === "GET" && url.pathname === "/api/pump/recent") {
        return json(res, 200, { launches: tapeStore.recent({ limit: 12 }), snapshot: tapeStore.snapshot() });
      }
      if (method === "POST" && url.pathname === "/api/pump/apply") {
        const body = await readBody(req);
        const raw = typeof body === "string" ? body : JSON.stringify(body);
        const message = parsePumpMessage(raw);
        if (message == null) return json(res, 400, { error: "unrecognized pump message" });
        tapeStore.apply(message);
        return json(res, 200, { launches: tapeStore.recent({ limit: 12 }) });
      }
      if (method === "GET" && url.pathname === "/api/solana/status") {
        return json(res, 200, await solana.getStatus());
      }
      if (method === "GET" && url.pathname === "/api/solana/tools") {
        return json(res, 200, { tools: [...SOLANA_ROUTED_TOOLS] });
      }
      if (method === "POST" && url.pathname === "/api/solana/wallets/local") {
        const body = await readBody(req);
        const created = await localWallets.generateLocalWallet(body);
        return json(res, 200, created);
      }
      if (method === "GET" && url.pathname === "/api/solana/wallets/local") {
        return json(res, 200, await localWallets.listLocalWallets());
      }
      const toolMatch = url.pathname.match(/^\/api\/solana\/tools\/([A-Za-z0-9_]+)$/);
      if (method === "POST" && toolMatch && isSolanaRoutedTool(toolMatch[1])) {
        const body = await readBody(req);
        const result = await executeSolanaRoutedTool(solanaPort, toolMatch[1], body);
        return json(res, 200, result);
      }
      return json(res, 404, { error: `no route: ${method} ${url.pathname}` });
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

const launchedDirectly =
  Boolean(process.argv[1]) && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url;
if (launchedDirectly) {
  const server = createHarnessServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`${PRODUCT_NAME} harness on http://127.0.0.1:${PORT}`);
  });
}

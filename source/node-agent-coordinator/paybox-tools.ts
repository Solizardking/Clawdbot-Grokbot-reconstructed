import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { getBoxSecretsStorePath } from "../host/extensions/secrets/secrets-service.js";

const ENDPOINT = "https://api.paybox.sh/mcp";
const PREFIX = "paybox_";
type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue => value != null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
export interface PayboxTool { name: string; toolName: string; providerIdentifier: string; description: string; inputSchema: unknown }
const statusTool: PayboxTool = { name: "paybox_status", toolName: "paybox_status", providerIdentifier: "paybox", description: "Check PayBox connection and signing readiness without spending or exposing credentials. If disconnected, the user connects with npm run paybox:login; signing keys go in the masked desktop PayBox field or PAYBOX_SIGNING_KEY, never chat.", inputSchema: { type: "object", properties: {}, additionalProperties: false } };
let desktopSecretReader: ((key: string) => Promise<string | null>) | undefined;
export function setPayboxSecretReader(reader: (key: string) => Promise<string | null>): void { desktopSecretReader = reader; }

function storedSecret(key: string): string | undefined {
  try { const value = record(JSON.parse(readFileSync(getBoxSecretsStorePath(), "utf8"))).secrets?.[key]; return typeof value === "string" && value.trim() ? value.trim() : undefined; } catch { return undefined; }
}

/** Serializes rotating OAuth credentials across this app’s desktop and bridge processes. The external PayBox CLI does not share this lock. */
async function withCredentialLock<T>(work: () => Promise<T>): Promise<T> {
  const { configFile } = await import("@paybox-sh/sdk");
  const lock = `${configFile()}.grok-lock`;
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 30_000;
  while (true) {
    try { const handle = await open(lock, "wx", 0o600); await handle.writeFile(String(process.pid)); await handle.close(); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const pid = Number(await readFile(lock, "utf8"));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") { await rm(lock, { force: true }); continue; } }
        }
      } catch {}
      if (Date.now() >= deadline) throw new Error("PayBox credentials are in use by another local operation. Try again after it completes.");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await work(); } finally { await rm(lock, { force: true }); }
}

async function credentials() {
  const { loadConfig, refreshTokens, saveConfig } = await import("@paybox-sh/sdk");
  const cfg = loadConfig();
  const secret = async (key: string) => process.env[key]?.trim() || (await desktopSecretReader?.(key)) || storedSecret(key);
  const signingKey = await secret("PAYBOX_SIGNING_KEY") || cfg.signingKey;
  const direct = await secret("PAYBOX_ACCESS_TOKEN") || await secret("PAYBOX_API_KEY") || cfg.apiKey;
  if (direct) return { token: direct, signingKey };
  if (!cfg.oauth) return { token: undefined, signingKey };
  if (cfg.baseUrl && cfg.baseUrl.replace(/\/$/, "") !== "https://api.paybox.sh") throw new Error("The saved PayBox login belongs to a different endpoint. Use a separate production PAYBOX_CONFIG_DIR.");
  if (cfg.oauth.expiresAt && Date.now() >= cfg.oauth.expiresAt - 60_000) {
    cfg.oauth = await refreshTokens("https://api.paybox.sh", cfg.oauth);
    saveConfig(cfg);
  }
  return { token: cfg.oauth.accessToken, signingKey };
}

/** Excludes signing envelopes and long-lived secrets from model-visible results. */
export function sanitizePayboxResult(value: unknown): unknown {
  if (typeof value === "string") {
    try { return JSON.stringify(sanitizePayboxResult(JSON.parse(value))); } catch {}
    return value.replace(/pbxk1\.[A-Za-z0-9._-]+/g, "[redacted signing key]");
  }
  if (Array.isArray(value)) return value.map(sanitizePayboxResult);
  if (value == null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(refresh_?token|access_?token|signing_?key|private_?key|envelope|envelope_bytes|typed_data|txs|binding)$/i.test(key)).map(([key, item]) => [key, sanitizePayboxResult(item)]));
}

export function createPayboxTools(options: { fetchImpl?: typeof fetch; resolveCredentials?: () => Promise<{ token: string | undefined; signingKey: string | undefined }>; locked?: <T>(work: () => Promise<T>) => Promise<T> } = {}) {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const locked = options.locked ?? withCredentialLock;
  const resolveCredentials = options.resolveCredentials ?? credentials;
  let session: string | null = null, initialized = false, identity = "", nextId = 0;
  let cached: PayboxTool[] = [], cachedAt = 0, lastError: string | null = null;
  let serverInstructions = "";

  async function rpc(token: string, method: string, params?: unknown, notification = false): Promise<any> {
    const id = ++nextId;
    const response = await fetchImpl(ENDPOINT, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(method === "tools/call" ? 180_000 : 30_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, ...(params == null ? {} : { params }) }),
    });
    if (!response.ok) { if ([401, 403, 404].includes(response.status)) { initialized = false; session = null; cached = []; } throw new Error(`PayBox ${method} failed (HTTP ${response.status}). Check the connection and grants; do not replay a payment.`); }
    session = response.headers.get("mcp-session-id") ?? session;
    if (notification) { await response.body?.cancel(); return; }
    const raw = await response.text();
    const messages = response.headers.get("content-type")?.includes("text/event-stream")
      ? raw.split(/\r?\n\r?\n/).flatMap(event => { const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n"); try { return [JSON.parse(data)]; } catch { return []; } })
      : [JSON.parse(raw)];
    const message = messages.find(row => row?.id === id);
    if (!message) throw new Error("PayBox returned no matching JSON-RPC response.");
    if (message.error) throw new Error(`PayBox ${method} returned RPC error ${message.error.code ?? "unknown"}.`);
    return message.result;
  }
  async function initialize(token: string) {
    const key = createHash("sha256").update(token).digest("hex");
    if (key !== identity) { identity = key; initialized = false; session = null; cached = []; }
    if (initialized) return;
    const result = await rpc(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "grok-bot-reconstructed", version: "0.18.0" } });
    serverInstructions = typeof result?.instructions === "string" ? result.instructions : "";
    await rpc(token, "notifications/initialized", undefined, true);
    initialized = true;
  }
  async function discover(token: string): Promise<PayboxTool[]> {
    await initialize(token);
    if (cached.length && Date.now() - cachedAt < 300_000) return cached;
    const tools: PayboxTool[] = [], cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await rpc(token, "tools/list", cursor ? { cursor } : {});
      if (!Array.isArray(result?.tools)) throw new Error("PayBox tools/list returned no tool inventory.");
      for (const item of result.tools) {
        if (typeof item.name !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.name) || /^(submit_|moonx_)/.test(item.name)) continue;
        tools.push({ name: PREFIX + item.name, toolName: PREFIX + item.name, providerIdentifier: "paybox", description: `${item.description ?? item.name}\nPayBox: pending is not success; poll get_request rather than resubmitting.`, inputSchema: item.inputSchema });
      }
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (cursor && cursors.has(cursor)) throw new Error("PayBox repeated a tool-list cursor.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    cached = tools; cachedAt = Date.now(); return tools;
  }
  return {
    async list(): Promise<PayboxTool[]> {
      try { return await locked(async () => { const { token } = await resolveCredentials(); if (!token) return [statusTool]; const listed = await discover(token); lastError = null; return [statusTool, ...listed]; }); }
      catch (error) { lastError = error instanceof Error ? error.message : "PayBox connection failed"; return [statusTool]; }
    },
    async execute(name: string, args: unknown): Promise<unknown> {
      return locked(async () => {
        const { token, signingKey } = await resolveCredentials();
        const sdk = signingKey ? new (await import("@paybox-sh/sdk")).PayboxClient({ ...(token ? { token } : {}), signingKey, fetchImpl }) : null;
        if (name === statusTool.name) return { authenticated: Boolean(token), canSign: sdk?.canSign ?? false, connectionError: lastError, instructions: sanitizePayboxResult(serverInstructions), setup: "npm run paybox:login; then save the scoped signing key in Settings → Router → PayBox or PAYBOX_SIGNING_KEY. Never paste keys into chat." };
        if (!token) throw new Error("PayBox is not connected. Run npm run paybox:login.");
        const tools = await discover(token);
        if (!tools.some(tool => tool.name === name)) throw new Error("PayBox tool is not granted or advertised by this connection.");
        const bare = name.slice(PREFIX.length), input = record(args);
        let result: unknown;
        // The SDK supplies headless signing for these supported wire schemas.
        // MCP-only/advanced tools retain the server's approval and signing flow.
        if (sdk?.canSign && bare === "request_swap") {
          const camel = Object.fromEntries(Object.entries(input).filter(([, value]) => value != null).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]));
          result = await sdk.requestSwap(camel as unknown as Parameters<typeof sdk.requestSwap>[0]);
        } else if (sdk?.canSign && bare === "request_wallet_sign") {
          result = await sdk.requestWalletSign({ credentialId: input.credential_id, intent: input.intent });
        } else if (sdk?.canSign && bare === "pay_x402" && (input.x402_version == null || input.x402_version === 1) && input.resource == null) {
          result = await sdk.payX402({ credentialId: input.credential_id, accepts: input.accepts, resourceUrl: input.resource_url });
        } else if (sdk?.canSign && bare === "use_service" && input.mode == null && input.headers == null) {
          result = await sdk.useService({ credentialId: input.credential_id, url: input.url, ...(input.method == null ? {} : { method: input.method }), ...(input.body == null ? {} : { body: input.body }) });
        } else {
          result = await rpc(token, "tools/call", { name: bare, arguments: input });
        }
        return sanitizePayboxResult(result);
      });
    },
  };
}

const shared = createPayboxTools();
export const payboxRoutedTools = () => process.env.PAYBOX_ENABLED === "0" ? Promise.resolve([]) : shared.list();
export const executePayboxRoutedTool = (name: string, args: unknown) => shared.execute(name, args);
export const isPayboxRoutedTool = (name: unknown): name is string => typeof name === "string" && name.startsWith(PREFIX);

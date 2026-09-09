import { readFileSync } from "node:fs";

import { getBoxSecretsStorePath } from "../host/extensions/secrets/secrets-service.js";

const KERNEL_MCP_URL = "https://mcp.onkernel.com/mcp";
const KERNEL_MCP_PREFIX = "kernel_";

export function kernelApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = env.KERNEL_API_KEY?.trim();
  if (direct != null && direct.length > 0) return direct;
  try {
    const parsed = JSON.parse(readFileSync(getBoxSecretsStorePath(), "utf8")) as { secrets?: Record<string, unknown> };
    const stored = parsed.secrets?.KERNEL_API_KEY;
    return typeof stored === "string" && stored.trim().length > 0 ? stored.trim() : undefined;
  } catch {
    return undefined;
  }
}

type JsonRpcResponse = { jsonrpc?: string; id?: number | string | null; result?: unknown; error?: { code?: number; message?: string } };

export interface KernelFetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string> }>;
}

interface KernelSessionState {
  sessionId: string | null;
  nextId: number;
}

async function rpc(state: KernelSessionState, apiKey: string, fetchImpl: KernelFetchLike, method: string, params: unknown, notification = false): Promise<JsonRpcResponse["result"]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), method === "tools/call" ? 180_000 : 30_000);
  timeout.unref?.();
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${apiKey}`,
    };
    if (state.sessionId != null) headers["mcp-session-id"] = state.sessionId;
    const body: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (!notification) body.id = state.nextId += 1;
    if (params !== undefined) body.params = params;
    const response = await fetchImpl(KERNEL_MCP_URL, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const claimedSession = response.headers.get("mcp-session-id");
    if (claimedSession != null && claimedSession.length > 0) state.sessionId = claimedSession;
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = await response.json() as JsonRpcResponse;
        if (payload.error?.message != null) detail = payload.error.message;
      } catch {}
      throw new Error(`Kernel MCP ${method} failed: ${detail}`);
    }
    if (notification) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const raw = await response.text();
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const payload = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
          if (payload.id === undefined || payload.error == null && payload.result !== undefined) return payload.result;
          if (payload.error != null) throw new Error(`Kernel MCP ${method} failed: ${payload.error.message ?? "unknown error"}`);
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
      throw new Error(`Kernel MCP ${method} returned an unreadable event stream.`);
    }
    const payload = await response.json() as JsonRpcResponse;
    if (payload.error != null) throw new Error(`Kernel MCP ${method} failed: ${payload.error.message ?? "unknown error"}`);
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureInitialized(state: KernelSessionState, apiKey: string, fetchImpl: KernelFetchLike): Promise<void> {
  if (state.sessionId != null) return;
  await rpc(state, apiKey, fetchImpl, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "grok-bot-reconstructed", version: "0.18.0" },
  });
  await rpc(state, apiKey, fetchImpl, "notifications/initialized", undefined, true);
}

type KernelToolDef = { readonly name: string; readonly description?: string; readonly inputSchema?: unknown };

export interface KernelRoutedTool {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

const KERNEL_PROVIDER = "kernel-cloud-browser";

let state: KernelSessionState = { sessionId: null, nextId: 0 };
let cache: { atMs: number; tools: readonly KernelToolDef[] } | null = null;
let testOverrides: { apiKey?: string; fetchImpl?: KernelFetchLike } | {};

function resolveDeps(): { apiKey: string | undefined; fetchImpl: KernelFetchLike } {
  const overrides = testOverrides as { apiKey?: string; fetchImpl?: KernelFetchLike };
  return { apiKey: overrides.apiKey ?? kernelApiKey(), fetchImpl: overrides.fetchImpl ?? (globalThis.fetch as unknown as KernelFetchLike) };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function kernelRoutedTools(options?: { refresh?: boolean }): Promise<readonly KernelRoutedTool[]> {
  const { apiKey, fetchImpl } = resolveDeps();
  if (apiKey == null) return [];
  if (!options?.refresh && cache != null && Date.now() - cache.atMs < 300_000) return project(cache.tools);
  try {
    await ensureInitialized(state, apiKey, fetchImpl);
    const result = record(await rpc(state, apiKey, fetchImpl, "tools/list", {}));
    const listed = Array.isArray(result?.tools) ? result.tools.flatMap((raw): KernelToolDef[] => {
      const row = record(raw);
      return row != null && typeof row.name === "string" && row.name.length > 0 ? [row as KernelToolDef] : [];
    }) : [];
    cache = { atMs: Date.now(), tools: listed };
    return project(listed);
  } catch {
    state.sessionId = null;
    return cache != null ? project(cache.tools) : [];
  }
}

function project(listed: readonly KernelToolDef[]): readonly KernelRoutedTool[] {
  return listed.map(tool => ({
    name: `${KERNEL_MCP_PREFIX}${tool.name}`,
    toolName: `${KERNEL_MCP_PREFIX}${tool.name}`,
    providerIdentifier: KERNEL_PROVIDER,
    description: tool.description ?? `${tool.name} on Kernel cloud browsers.`,
    inputSchema: record(tool.inputSchema) ?? { type: "object", properties: {}, additionalProperties: true },
  }));
}

export function isKernelRoutedTool(name: unknown): boolean {
  return typeof name === "string" && name.startsWith(KERNEL_MCP_PREFIX);
}

export async function executeKernelRoutedTool(routedName: string, args: unknown): Promise<unknown> {
  const bare = routedName.startsWith(KERNEL_MCP_PREFIX) ? routedName.slice(KERNEL_MCP_PREFIX.length) : routedName;
  const { apiKey, fetchImpl } = resolveDeps();
  if (apiKey == null) throw new Error("Set KERNEL_API_KEY to control the bot's cloud browser.");
  await ensureInitialized(state, apiKey, fetchImpl);
  const result = record(await rpc(state, apiKey, fetchImpl, "tools/call", { name: bare, arguments: args ?? {} }));
  if (result == null) throw new Error(`Kernel tool ${bare} returned no result.`);
  if (result.isError === true) {
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.flatMap((item): string[] => {
      const row = record(item);
      return row != null && row.type === "text" && typeof row.text === "string" ? [row.text] : [];
    }).join("\n");
    throw new Error(text.length > 0 ? text : `Kernel tool ${bare} failed.`);
  }
  const structured = record(result.structuredContent);
  if (structured != null) return structured;
  const content = Array.isArray(result.content) ? result.content : [];
  const texts = content.flatMap((item): string[] => {
    const row = record(item);
    return row != null && row.type === "text" && typeof row.text === "string" ? [row.text] : [];
  });
  if (texts.length === 1) {
    try { return JSON.parse(texts[0]!) as unknown; } catch { return texts[0]; }
  }
  if (texts.length > 1) return { text: texts.join("\n") };
  const images = content.flatMap((item): Record<string, unknown>[] => {
    const row = record(item);
    return row != null && row.type === "image" && typeof row.data === "string" ? [row] : [];
  });
  if (images.length > 0) return { images: images.map(row => ({ mimeType: row.mimeType ?? "image/png", base64: row.data })) };
  return result;
}

export function configureKernelBridgeForTests(overrides: { apiKey?: string; fetchImpl?: KernelFetchLike } | null): void {
  testOverrides = overrides ?? {};
  state.sessionId = null;
  cache = null;
}

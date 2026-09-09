import { readFileSync } from "node:fs";

import { getBoxSecretsStorePath } from "../host/extensions/secrets/secrets-service.js";

const BROWSER_USE_BASE_URL = process.env.BROWSER_USE_BASE_URL?.trim() || "https://api.browser-use.com/api/v4";
const BROWSER_USE_PROVIDER = "grok-bot-local-browser-use";
const API_KEY_NAMES = ["BROWSER_USE_API_KEY", "BROWSERUSE_API_KEY"] as const;
const TERMINAL_STATUS = ["completed", "failed", "cancelled", "stopped", "error"];

export function browserUseApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of API_KEY_NAMES) {
    const direct = env[name]?.trim();
    if (direct != null && direct.length > 0) return direct;
  }
  try {
    const parsed = JSON.parse(readFileSync(getBoxSecretsStorePath(), "utf8")) as { secrets?: Record<string, unknown> };
    for (const name of API_KEY_NAMES) {
      const stored = parsed.secrets?.[name];
      if (typeof stored === "string" && stored.trim().length > 0) return stored.trim();
    }
  } catch {}
  return undefined;
}

export interface BrowserUseFetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pickString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

async function apiRequest(fetchImpl: BrowserUseFetchLike, apiKey: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${BROWSER_USE_BASE_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-browser-use-api-key": apiKey },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const payload = record(await response.json());
        const message = payload == null ? undefined : pickString(payload, ["message", "detail", "error"]);
        if (message != null) detail = message;
      } catch {}
      throw new Error(`Browser Use ${method} ${path} failed: ${detail}`);
    }
    if (response.status === 204) return {};
    return await response.json();
  } finally { clearTimeout(timeout); }
}

const defaultSleep = async (ms: number): Promise<void> => {
  await new Promise<void>(resolve => setTimeout(resolve, ms).unref?.());
};

function liveViewUrl(run: unknown): string | undefined {
  const row = record(run);
  if (row == null) return undefined;
  const direct = pickString(row, ["liveUrl", "live_url", "browserLiveViewUrl", "browser_live_view_url"]);
  if (direct != null) return direct;
  return liveViewUrl(row.session ?? row.browser);
}

type SleepImpl = (ms: number) => Promise<void>;

export type BrowserUseRoutedTool = {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

const RUN_TASK_SCHEMA = {
  type: "object",
  properties: {
    task: { type: "string", minLength: 1, description: "Natural-language goal for the cloud browser agent, e.g. 'Go to news.ycombinator.com and list the top 5 stories with points'." },
    model: { type: "string", description: "Optional Browser Use V4 model id, e.g. grok-4.5. Omit to use the provider default." },
    wait: { type: "boolean", default: true, description: "Poll until the run finishes before replying. Use false to start it in the background." },
    poll_interval_seconds: { type: "integer", minimum: 2, maximum: 15, default: 5 },
    max_wait_seconds: { type: "integer", minimum: 10, maximum: 900, default: 600 },
  },
  required: ["task"],
  additionalProperties: false,
} as const;

const ID_SCHEMA = {
  type: "object",
  properties: { id: { type: "string", minLength: 1, description: "Browser Use run id returned by browseruse_run_task." } },
  required: ["id"],
  additionalProperties: false,
} as const;

const FOLLOW_UP_SCHEMA = {
  type: "object",
  properties: {
    session_id: { type: "string", minLength: 1, description: "Session id from a previous browseruse_run_task result." },
    text: { type: "string", minLength: 1, description: "Follow-up instruction queued as the next turn of that session's conversation." },
    interrupt: { type: "boolean", default: false, description: "Run immediately instead of waiting for the current turn to finish." },
  },
  required: ["session_id", "text"],
  additionalProperties: false,
} as const;

const LAUNCH_BROWSER_SCHEMA = {
  type: "object",
  properties: {
    proxy_country_code: { type: "string", default: "us", description: "Residential proxy country for the session, e.g. us. Pass null to disable the managed proxy." },
  },
  additionalProperties: false,
} as const;

const STOP_BROWSER_SCHEMA = {
  type: "object",
  properties: { id: { type: "string", minLength: 1, description: "Browser session id returned by browseruse_launch_browser." } },
  required: ["id"],
  additionalProperties: false,
} as const;

export const BROWSER_USE_ROUTED_TOOLS: readonly BrowserUseRoutedTool[] = [
  {
    name: "browseruse_run_task",
    toolName: "browseruse_run_task",
    providerIdentifier: BROWSER_USE_PROVIDER,
    description: "Delegate a web task to a stealth Browser Use cloud agent: it drives its own hosted Chromium (navigation, clicking, typing, logins via saved profiles) server-side and returns the final answer. Runs are long-horizon; prefer wait=false plus browseruse_task_status/result for tasks expected to take minutes.",
    inputSchema: RUN_TASK_SCHEMA,
  },
  {
    name: "browseruse_task_status",
    toolName: "browseruse_task_status",
    providerIdentifier: BROWSER_USE_PROVIDER,
    description: "Cheap status lookup for a Browser Use run started earlier (created/running/completed/failed/cancelled).",
    inputSchema: ID_SCHEMA,
  },
  {
    name: "browseruse_task_result",
    toolName: "browseruse_task_result",
    providerIdentifier: BROWSER_USE_PROVIDER,
    description: "Fetch the full Browser Use run payload: final result text, status, live view URL, session id, and error details once terminal.",
    inputSchema: ID_SCHEMA,
  },
  {
    name: "browseruse_follow_up",
    toolName: "browseruse_follow_up",
    providerIdentifier: BROWSER_USE_PROVIDER,
    description: "Queue a follow-up instruction into an existing Browser Use session so the same conversation and live browser continue.",
    inputSchema: FOLLOW_UP_SCHEMA,
  },
  {
    name: "browseruse_launch_browser",
    toolName: "browseruse_launch_browser",
    providerIdentifier: BROWSER_USE_PROVIDER,
    description: "Launch a raw Browser Use cloud Chromium and get its CDP WebSocket URL plus live view URL, for direct remote-browser control or sharing with the user.",
    inputSchema: LAUNCH_BROWSER_SCHEMA,
  },
  {
    name: "browseruse_stop_browser",
    toolName: "browseruse_stop_browser",
    providerIdentifier: BROWSER_USE_PROVIDER,
    description: "Stop a previously launched Browser Use cloud browser session to end billing (unused time is refunded by the provider).",
    inputSchema: STOP_BROWSER_SCHEMA,
  },
];

let testOverrides: { apiKey?: string; fetchImpl?: BrowserUseFetchLike; sleepImpl?: SleepImpl } | {} = {};

function resolveDeps(): { apiKey: string | undefined; fetchImpl: BrowserUseFetchLike; sleep: SleepImpl } {
  const overrides = testOverrides as { apiKey?: string; fetchImpl?: BrowserUseFetchLike; sleepImpl?: SleepImpl };
  return { apiKey: overrides.apiKey ?? browserUseApiKey(), fetchImpl: overrides.fetchImpl ?? (globalThis.fetch as unknown as BrowserUseFetchLike), sleep: overrides.sleepImpl ?? defaultSleep };
}

export function browserUseRoutedTools(): readonly BrowserUseRoutedTool[] {
  if (resolveDeps().apiKey == null) return [];
  return BROWSER_USE_ROUTED_TOOLS;
}

export function isBrowserUseRoutedTool(name: unknown): boolean {
  return typeof name === "string" && BROWSER_USE_ROUTED_TOOLS.some(tool => tool.name === name);
}

async function pollUntilTerminal(apiKey: string, fetchImpl: BrowserUseFetchLike, sleep: SleepImpl, id: string, intervalMs: number, maxWaitMs: number): Promise<{ terminal: boolean; status: unknown }> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const statusRow = record(await apiRequest(fetchImpl, apiKey, "GET", `/runs/${encodeURIComponent(id)}/status`));
    const status = typeof statusRow?.status === "string" ? statusRow.status : undefined;
    if (status != null && TERMINAL_STATUS.some(terminal => status.toLowerCase().includes(terminal))) return { terminal: true, status };
  }
  return { terminal: false, status: undefined };
}

export async function executeBrowserUseRoutedTool(name: string, args: unknown): Promise<unknown> {
  const { apiKey, fetchImpl, sleep } = resolveDeps();
  if (apiKey == null) throw new Error(`Set ${API_KEY_NAMES[0]} (or ${API_KEY_NAMES[1]}) to use Browser Use cloud browsers.`);
  const options = record(args) ?? {};

  switch (name) {
    case "browseruse_run_task": {
      const task = typeof options.task === "string" ? options.task.trim() : "";
      if (task.length === 0) throw new Error("browseruse_run_task requires a non-empty task.");
      const wait = options.wait !== false;
      const intervalMs = Math.min(Math.max(typeof options.poll_interval_seconds === "number" ? options.poll_interval_seconds * 1000 : 5000, 2000), 15000);
      const maxWaitMs = Math.min(Math.max(typeof options.max_wait_seconds === "number" ? options.max_wait_seconds * 1000 : 600000, 10000), 900000);
      const created = record(await apiRequest(fetchImpl, apiKey, "POST", "/runs", {
        task,
        ...(typeof options.model === "string" && options.model.length > 0 ? { model: options.model } : {}),
      }));
      const id = created == null ? undefined : pickString(created, ["id", "runId", "run_id"]);
      if (id == null) return created ?? {};
      if (!wait) return { ...created, note: "Run started in the background. Poll browseruse_task_status, then fetch browseruse_task_result." };
      const { terminal } = await pollUntilTerminal(apiKey, fetchImpl, sleep, id, intervalMs, maxWaitMs);
      const full = record(await apiRequest(fetchImpl, apiKey, "GET", `/runs/${encodeURIComponent(id)}`));
      const view = liveViewUrl(full);
      return {
        ...(full ?? {}),
        ...(view == null ? {} : { liveUrl: view }),
        ...(terminal ? {} : { timedOutWaiting: true, maxWaitSeconds: maxWaitMs / 1000, note: "Still running. Keep polling browseruse_task_status / browseruse_task_result." }),
      };
    }
    case "browseruse_task_status":
      return await apiRequest(fetchImpl, apiKey, "GET", `/runs/${encodeURIComponent(String(options.id ?? ""))}/status`);
    case "browseruse_task_result": {
      const full = await apiRequest(fetchImpl, apiKey, "GET", `/runs/${encodeURIComponent(String(options.id ?? ""))}`);
      const view = liveViewUrl(full);
      return view == null ? full : { ...(record(full) ?? { value: full }), liveUrl: view };
    }
    case "browseruse_follow_up": {
      const sessionId = typeof options.session_id === "string" ? options.session_id : "";
      const text = typeof options.text === "string" ? options.text.trim() : "";
      if (sessionId.length === 0 || text.length === 0) throw new Error("browseruse_follow_up requires session_id and text.");
      return await apiRequest(fetchImpl, apiKey, "POST", `/sessions/${encodeURIComponent(sessionId)}/queue`, { text, interrupt: options.interrupt === true });
    }
    case "browseruse_launch_browser":
      return await apiRequest(fetchImpl, apiKey, "POST", "/browsers", {
        ...(options.proxy_country_code === null ? { proxyCountryCode: null } : { proxyCountryCode: typeof options.proxy_country_code === "string" && options.proxy_country_code.length > 0 ? options.proxy_country_code : "us" }),
      });
    case "browseruse_stop_browser": {
      const id = typeof options.id === "string" ? options.id : "";
      if (id.length === 0) throw new Error("browseruse_stop_browser requires the browser session id.");
      return await apiRequest(fetchImpl, apiKey, "PATCH", `/browsers/${encodeURIComponent(id)}`, { action: "stop" });
    }
    default:
      throw new Error(`Unknown Browser Use tool: ${name}`);
  }
}

export function configureBrowserUseBridgeForTests(overrides: { apiKey?: string; fetchImpl?: BrowserUseFetchLike; sleepImpl?: SleepImpl } | null): void {
  testOverrides = overrides ?? {};
}

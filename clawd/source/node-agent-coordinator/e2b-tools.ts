import { readFileSync } from "node:fs";

import { getBoxSecretsStorePath } from "../host/extensions/secrets/secrets-service.js";

const E2B_PROVIDER = "grok-bot-local-e2b-desktop";
const SESSION_TIMEOUT_MS = 15 * 60_000;
const RESOLUTION: readonly [number, number] = [1280, 800];

export function e2bApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = env.E2B_API_KEY?.trim();
  if (direct != null && direct.length > 0) return direct;
  try {
    const parsed = JSON.parse(readFileSync(getBoxSecretsStorePath(), "utf8")) as { secrets?: Record<string, unknown> };
    const stored = parsed.secrets?.E2B_API_KEY;
    return typeof stored === "string" && stored.trim().length > 0 ? stored.trim() : undefined;
  } catch {
    return undefined;
  }
}

export interface E2bDesktopSandboxLike {
  screenshot(): Promise<Uint8Array | ArrayBuffer | string>;
  leftClick(x: number, y: number): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  rightClick(x: number, y: number): Promise<void>;
  middleClick(x: number, y: number): Promise<void>;
  moveMouse(x: number, y: number): Promise<void>;
  drag(from: readonly [number, number], to: readonly [number, number]): Promise<void>;
  write(text: string): Promise<void>;
  press(keys: string): Promise<void>;
  scroll(direction: "up" | "down", amount: number): Promise<void>;
  commands: { run(command: string): Promise<{ stdout?: string; stderr?: string; exitCode?: number }> };
  stream: { start(): Promise<unknown>; getUrl(): string };
  setTimeout?(timeoutMs: number): Promise<unknown>;
  kill(): Promise<void>;
}

export interface E2bDesktopSdkLike {
  create(options: { apiKey: string; resolution: readonly [number, number]; dpi: number; timeoutMs: number }): Promise<E2bDesktopSandboxLike & { sandboxId?: string }>;
}

interface DesktopSession {
  sandbox: E2bDesktopSandboxLike;
  id: string | null;
  streamUrl: string | null;
}

type DesktopModule = { Sandbox?: unknown };

let session: DesktopSession | null = null;
let testOverrides: { apiKey?: string; sdk?: E2bDesktopSdkLike } | {} = {};

function resolveDeps(): { apiKey: string | undefined; sdkOverride: E2bDesktopSdkLike | undefined } {
  const overrides = testOverrides as { apiKey?: string; sdk?: E2bDesktopSdkLike };
  return { apiKey: overrides.apiKey ?? e2bApiKey(), sdkOverride: overrides.sdk };
}

async function loadDesktopSdk(): Promise<E2bDesktopSdkLike> {
  const override = resolveDeps().sdkOverride;
  if (override != null) return override;
  const imported = await import("@e2b/desktop") as unknown as DesktopModule;
  const Sandbox = imported.Sandbox;
  if (typeof Sandbox !== "object" || Sandbox == null || typeof (Sandbox as { create?: unknown }).create !== "function") {
    throw new Error("The @e2b/desktop package did not expose the expected Sandbox.create API.");
  }
  return { create: options => (Sandbox as { create(o: typeof options): Promise<E2bDesktopSandboxLike & { sandboxId?: string }> }).create(options) };
}

function keepAlive(sandbox: E2bDesktopSandboxLike): void {
  void sandbox.setTimeout?.(SESSION_TIMEOUT_MS).catch(() => {});
}

async function ensureSession(): Promise<DesktopSession> {
  const { apiKey } = resolveDeps();
  if (apiKey == null) throw new Error("Set E2B_API_KEY to use the bot's E2B cloud desktop (Settings → Router).");
  if (session != null) { keepAlive(session.sandbox); return session; }
  const sdk = await loadDesktopSdk();
  let sandbox: E2bDesktopSandboxLike & { sandboxId?: string };
  try {
    sandbox = await sdk.create({ apiKey, resolution: RESOLUTION, dpi: 96, timeoutMs: SESSION_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`Could not start an E2B desktop sandbox: ${error instanceof Error ? error.message : String(error)}`);
  }
  let streamUrl: string | null = null;
  try {
    await sandbox.stream.start();
    streamUrl = sandbox.stream.getUrl();
  } catch {}
  session = { sandbox, id: typeof sandbox.sandboxId === "string" ? sandbox.sandboxId : null, streamUrl };
  return session;
}

async function stopSession(): Promise<void> {
  const current = session;
  session = null;
  if (current != null) await current.sandbox.kill().catch(() => {});
}

function toBytes(screenshot: Uint8Array | ArrayBuffer | string): Buffer {
  if (typeof screenshot === "string") return Buffer.from(screenshot, "base64");
  if (screenshot instanceof Uint8Array) return Buffer.from(screenshot);
  return Buffer.from(new Uint8Array(screenshot));
}

function coordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite pixel coordinate.`);
  return Math.round(value);
}

export type E2bRoutedTool = {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

const XY_SCHEMA = {
  x: { type: "number", description: "Pixel X on the desktop." },
  y: { type: "number", description: "Pixel Y on the desktop." },
} as const;

const STATUS_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const SCREENSHOT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const CLICK_SCHEMA = {
  type: "object",
  properties: {
    ...XY_SCHEMA,
    button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
    count: { type: "integer", enum: [1, 2], default: 1, description: "1 = single click, 2 = double click." },
  },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

const TYPE_SCHEMA = {
  type: "object",
  properties: { text: { type: "string", minLength: 1, description: "Text typed at the current focus." } },
  required: ["text"],
  additionalProperties: false,
} as const;

const KEY_SCHEMA = {
  type: "object",
  properties: { keys: { type: "string", minLength: 1, description: "Key or chord, e.g. Enter, Escape, ctrl+c, alt+Tab." } },
  required: ["keys"],
  additionalProperties: false,
} as const;

const SCROLL_SCHEMA = {
  type: "object",
  properties: {
    direction: { type: "string", enum: ["up", "down"], default: "down" },
    amount: { type: "integer", minimum: 1, maximum: 15, default: 3, description: "Scroll ticks." },
  },
  additionalProperties: false,
} as const;

const DRAG_SCHEMA = {
  type: "object",
  properties: {
    from_x: { type: "number" }, from_y: { type: "number" }, to_x: { type: "number" }, to_y: { type: "number" },
  },
  required: ["from_x", "from_y", "to_x", "to_y"],
  additionalProperties: false,
} as const;

const COMMAND_SCHEMA = {
  type: "object",
  properties: { command: { type: "string", minLength: 1, description: "Shell command executed inside the sandbox." } },
  required: ["command"],
  additionalProperties: false,
} as const;

export const E2B_ROUTED_TOOLS: readonly E2bRoutedTool[] = [
  {
    name: "e2b_computer_status",
    toolName: "e2b_computer_status",
    providerIdentifier: E2B_PROVIDER,
    description: "Boot (or report) the agent's private E2B cloud Linux desktop and return its sandbox id plus a browser-viewable VNC stream URL. Start here before other e2b_computer_* actions.",
    inputSchema: STATUS_SCHEMA,
  },
  {
    name: "e2b_computer_screenshot",
    toolName: "e2b_computer_screenshot",
    providerIdentifier: E2B_PROVIDER,
    description: "Capture a PNG screenshot of the E2B cloud desktop as base64. Call this whenever you need to see the current screen state.",
    inputSchema: SCREENSHOT_SCHEMA,
  },
  {
    name: "e2b_computer_click",
    toolName: "e2b_computer_click",
    providerIdentifier: E2B_PROVIDER,
    description: "Click the E2B cloud desktop at pixel coordinates (left/right/middle, single or double). Take a screenshot first to pick coordinates.",
    inputSchema: CLICK_SCHEMA,
  },
  {
    name: "e2b_computer_type",
    toolName: "e2b_computer_type",
    providerIdentifier: E2B_PROVIDER,
    description: "Type text into the currently focused window of the E2B cloud desktop.",
    inputSchema: TYPE_SCHEMA,
  },
  {
    name: "e2b_computer_key",
    toolName: "e2b_computer_key",
    providerIdentifier: E2B_PROVIDER,
    description: "Press a key or chord (Enter, Escape, ctrl+c, alt+Tab…) on the E2B cloud desktop.",
    inputSchema: KEY_SCHEMA,
  },
  {
    name: "e2b_computer_scroll",
    toolName: "e2b_computer_scroll",
    providerIdentifier: E2B_PROVIDER,
    description: "Scroll the E2B cloud desktop up or down by tick count.",
    inputSchema: SCROLL_SCHEMA,
  },
  {
    name: "e2b_computer_drag",
    toolName: "e2b_computer_drag",
    providerIdentifier: E2B_PROVIDER,
    description: "Drag from one pixel coordinate to another on the E2B cloud desktop.",
    inputSchema: DRAG_SCHEMA,
  },
  {
    name: "e2b_computer_run_command",
    toolName: "e2b_computer_run_command",
    providerIdentifier: E2B_PROVIDER,
    description: "Run a shell command inside the E2B cloud desktop machine (install packages, inspect files, launch GUI apps) and get stdout/stderr/exit code.",
    inputSchema: COMMAND_SCHEMA,
  },
  {
    name: "e2b_computer_stop",
    toolName: "e2b_computer_stop",
    providerIdentifier: E2B_PROVIDER,
    description: "Destroy the E2B cloud desktop sandbox when the work is done.",
    inputSchema: STATUS_SCHEMA,
  },
];

export function e2bRoutedTools(): readonly E2bRoutedTool[] {
  if (resolveDeps().apiKey == null) return [];
  return E2B_ROUTED_TOOLS;
}

export function isE2bRoutedTool(name: unknown): boolean {
  return typeof name === "string" && E2B_ROUTED_TOOLS.some(tool => tool.name === name);
}

export async function executeE2bRoutedTool(name: string, args: unknown): Promise<unknown> {
  if (name === "e2b_computer_stop") {
    await ensureSession().catch(() => {});
    await stopSession();
    return { stopped: true };
  }
  const current = await ensureSession();

  switch (name) {
    case "e2b_computer_status":
      return { sandboxId: current.id, resolution: RESOLUTION, streamUrl: current.streamUrl, note: current.streamUrl == null ? "VNC streaming unavailable; rely on screenshots." : "Open streamUrl in any browser to watch the desktop live." };
    case "e2b_computer_screenshot": {
      const bytes = toBytes(await current.sandbox.screenshot());
      return { format: "png", byteLength: bytes.byteLength, image_base64: bytes.toString("base64") };
    }
    case "e2b_computer_click": {
      const row = (typeof args === "object" && args != null ? args : {}) as Record<string, unknown>;
      const x = coordinate(row.x, "x"), y = coordinate(row.y, "y");
      const button = row.button === "right" || row.button === "middle" ? row.button : "left";
      if (row.count === 2 && button === "left") await current.sandbox.doubleClick(x, y);
      else if (button === "right") await current.sandbox.rightClick(x, y);
      else if (button === "middle") await current.sandbox.middleClick(x, y);
      else await current.sandbox.leftClick(x, y);
      return { clicked: { x, y, button, double: row.count === 2 }, note: "Call e2b_computer_screenshot to see the result." };
    }
    case "e2b_computer_type": {
      const text = (args as Record<string, unknown>).text;
      if (typeof text !== "string" || text.length === 0) throw new Error("e2b_computer_type requires text.");
      await current.sandbox.write(text);
      return { typed: text.length };
    }
    case "e2b_computer_key": {
      const keys = (args as Record<string, unknown>).keys;
      if (typeof keys !== "string" || keys.length === 0) throw new Error("e2b_computer_key requires keys.");
      await current.sandbox.press(keys);
      return { pressed: keys };
    }
    case "e2b_computer_scroll": {
      const row = (typeof args === "object" && args != null ? args : {}) as Record<string, unknown>;
      const direction: "up" | "down" = row.direction === "up" ? "up" : "down";
      const amount = Math.min(Math.max(typeof row.amount === "number" ? Math.round(row.amount) : 3, 1), 15);
      await current.sandbox.scroll(direction, amount);
      return { scrolled: direction, amount };
    }
    case "e2b_computer_drag": {
      const row = (typeof args === "object" && args != null ? args : {}) as Record<string, unknown>;
      const from: [number, number] = [coordinate(row.from_x, "from_x"), coordinate(row.from_y, "from_y")];
      const to: [number, number] = [coordinate(row.to_x, "to_x"), coordinate(row.to_y, "to_y")];
      await current.sandbox.drag(from, to);
      return { dragged: { from, to } };
    }
    case "e2b_computer_run_command": {
      const command = (args as Record<string, unknown>).command;
      if (typeof command !== "string" || command.length === 0) throw new Error("e2b_computer_run_command requires command.");
      const result = await current.sandbox.commands.run(command);
      return { exitCode: result.exitCode ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    }
    default:
      throw new Error(`Unknown E2B tool: ${name}`);
  }
}

export function configureE2bBridgeForTests(overrides: { apiKey?: string; sdk?: E2bDesktopSdkLike } | null): void {
  testOverrides = overrides ?? {};
  session = null;
}

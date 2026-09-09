import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { browserUseApiKey } from "./browser-use-tools.js";
import { e2bApiKey, executeE2bRoutedTool, isE2bRoutedTool } from "./e2b-tools.js";
import { clawdGatewayConfigured } from "./clawd-gateway-tools.js";
import { heliusTradingConfigured } from "./solana-trading-tools.js";

/**
 * OpenGrok-style box doctor for this reconstruction. E2B_API_KEY is "our
 * own box" (sandboxed Ubuntu desktop); BROWSER_USE_API_KEY /
 * BROWSERUSE_API_KEY is "our own computers" (stealth hosted Chromium).
 * Hop-session files from the OpenGrok sidecar live under box/ and tools/
 * so they can be pushed onto an E2B desktop.
 */
const PROVIDER = "grok-bot-local-cloud-box";
const here = dirname(fileURLToPath(import.meta.url));

export interface CloudBoxTool {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

export const CLOUD_BOX_ROUTED_TOOLS: readonly CloudBoxTool[] = [
  {
    name: "cloud_box_doctor",
    toolName: "cloud_box_doctor",
    providerIdentifier: PROVIDER,
    description: "Report whether the bot's own E2B box (E2B_API_KEY), Browser Use computers (BROWSER_USE_API_KEY / BROWSERUSE_API_KEY), Helius RPC, Clawd Gateway, and OpenGrok hop files are ready.",
    inputSchema: EMPTY_SCHEMA,
  },
  {
    name: "cloud_box_install_hop",
    toolName: "cloud_box_install_hop",
    providerIdentifier: PROVIDER,
    description: "Copy the OpenGrok hop session and provider maps onto the live E2B desktop at /home/user/sand-data so a cloud box can run the hop executor. Requires E2B_API_KEY.",
    inputSchema: EMPTY_SCHEMA,
  },
];

export function isCloudBoxRoutedTool(name: unknown): boolean {
  return typeof name === "string" && CLOUD_BOX_ROUTED_TOOLS.some(tool => tool.name === name);
}

export function cloudBoxRoutedTools(): readonly CloudBoxTool[] {
  return CLOUD_BOX_ROUTED_TOOLS;
}

function repoFile(relative: string): { path: string; present: boolean; bytes: number } {
  const candidates = [
    join(here, "..", "..", relative),
    join(process.cwd(), relative),
  ];
  for (const path of candidates) {
    try {
      const bytes = readFileSync(path);
      return { path, present: true, bytes: bytes.byteLength };
    } catch {}
  }
  return { path: candidates[0]!, present: false, bytes: 0 };
}

export function opengrokBoxFiles(): readonly { readonly name: string; readonly relative: string; readonly present: boolean; readonly bytes: number }[] {
  return [
    { name: "hop-session", relative: "box/openai-hop-session.cjs" },
    { name: "provider-maps", relative: "tools/provider-maps.cjs" },
    { name: "file-relay", relative: "tools/file-relay.py" },
    { name: "box-integration-doc", relative: "docs/opengrok/BOX-INTEGRATION.md" },
  ].map(entry => {
    const file = repoFile(entry.relative);
    return { name: entry.name, relative: entry.relative, present: file.present, bytes: file.bytes };
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function executeCloudBoxRoutedTool(name: string, args: unknown = {}): Promise<unknown> {
  void args;
  switch (name) {
    case "cloud_box_doctor": {
      const e2b = e2bApiKey();
      const browser = browserUseApiKey();
      const files = opengrokBoxFiles();
      return {
        ok: true,
        box: {
          provider: "e2b",
          configured: e2b != null,
          env: "E2B_API_KEY",
          note: "Our own sandboxed Ubuntu desktop. Tools e2b_computer_* appear when the key is set.",
        },
        computers: {
          provider: "browser-use",
          configured: browser != null,
          env: ["BROWSER_USE_API_KEY", "BROWSERUSE_API_KEY"],
          note: "Our own stealth hosted Chromium computers. Tools browseruse_* appear when the key is set.",
        },
        helius: { configured: heliusTradingConfigured(), env: ["HELIUS_RPC_URL", "HELIUS_API_KEY"] },
        clawdGateway: { configured: clawdGatewayConfigured(), env: ["CLAWD_GATEWAY_URL"] },
        opengrokFiles: files,
        missing: [
          ...(e2b == null ? ["E2B_API_KEY"] : []),
          ...(browser == null ? ["BROWSER_USE_API_KEY"] : []),
          ...(!heliusTradingConfigured() ? ["HELIUS_RPC_URL"] : []),
          ...files.filter(file => !file.present).map(file => file.relative),
        ],
      };
    }
    case "cloud_box_install_hop": {
      if (e2bApiKey() == null) throw new Error("Set E2B_API_KEY to install the OpenGrok hop onto the bot's own E2B box.");
      if (!isE2bRoutedTool("e2b_computer_run_command")) throw new Error("E2B computer tools are not registered.");
      const hop = repoFile("box/openai-hop-session.cjs");
      const maps = repoFile("tools/provider-maps.cjs");
      if (!hop.present || !maps.present) {
        throw new Error("OpenGrok hop files are missing from the app tree (box/openai-hop-session.cjs, tools/provider-maps.cjs).");
      }
      const hopBytes = readFileSync(hop.path);
      const mapsBytes = readFileSync(maps.path);
      const mkdir = await executeE2bRoutedTool("e2b_computer_run_command", { command: "mkdir -p /home/user/sand-data" });
      const writeHop = await executeE2bRoutedTool("e2b_computer_run_command", {
        command: `python3 - <<'PY'\nfrom pathlib import Path\nPath('/home/user/sand-data/openai-hop-session.cjs').write_bytes(${JSON.stringify(Buffer.from(hopBytes).toString("base64"))}.encode() if False else __import__('base64').b64decode(${JSON.stringify(Buffer.from(hopBytes).toString("base64"))}))\nPath('/home/user/sand-data/provider-maps.cjs').write_bytes(__import__('base64').b64decode(${JSON.stringify(Buffer.from(mapsBytes).toString("base64"))}))\nprint('wrote', Path('/home/user/sand-data/openai-hop-session.cjs').stat().st_size, Path('/home/user/sand-data/provider-maps.cjs').stat().st_size)\nPY`,
      });
      const check = await executeE2bRoutedTool("e2b_computer_run_command", {
        command: "node --check /home/user/sand-data/openai-hop-session.cjs && node --check /home/user/sand-data/provider-maps.cjs && ls -l /home/user/sand-data",
      });
      return {
        ok: true,
        dest: "/home/user/sand-data",
        hopBytes: hop.bytes,
        mapsBytes: maps.bytes,
        mkdir: record(mkdir),
        write: record(writeHop),
        check: record(check),
      };
    }
    default:
      throw new Error(`Unknown cloud box tool: ${name}`);
  }
}

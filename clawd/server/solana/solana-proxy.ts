// Solana / pump / Jupiter MCP proxy — spawned as an MCP server inside a bot's
// agent process. Lists the eleven grok-bot tool names and forwards every call
// back to the harness so wallet secrets never enter the CLI child.
import readline from "node:readline";

import { JUPITER_SWAP_ROUTED_TOOLS } from "./jupiter-swap-tools.ts";
import { PUMP_ROUTED_TOOLS } from "./pump-tape.ts";
import { SOLANA_ROUTED_TOOLS } from "./solana-routed-tools.ts";

const HARNESS = process.env.OMB_HARNESS_URL ?? "http://127.0.0.1:8799";
const TOKEN = process.env.OMB_COMMS_TOKEN ?? "";

const TOOLS = [...SOLANA_ROUTED_TOOLS, ...PUMP_ROUTED_TOOLS, ...JUPITER_SWAP_ROUTED_TOOLS].map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
}));

type Json = Record<string, unknown>;
const send = (msg: Json) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });
const textResult = (id: unknown, text: string, isError = false) => ok(id, { content: [{ type: "text", text }], isError });

async function callHarness(name: string, args: Json): Promise<{ text: string; isError?: boolean }> {
  const res = await fetch(`${HARNESS}/api/internal/solana/tools`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ name, arguments: args }),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) return { text: String(body.error ?? `HTTP ${res.status}`), isError: true };
  return { text: JSON.stringify(body.result ?? body, null, 2), isError: body.ok === false };
}

async function handle(msg: Json) {
  const id = msg.id;
  const method = msg.method as string | undefined;
  if (!method) return;
  const params = (msg.params ?? {}) as Json;
  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: (params.protocolVersion as string) ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "clawdbot-solana", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      ok(id, {});
      return;
    case "tools/list":
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = params.name as string;
      if (!TOOLS.some((t) => t.name === name)) return rpcErr(id, -32602, `Unknown tool: ${name}`);
      try {
        const { text, isError } = await callHarness(name, (params.arguments ?? {}) as Json);
        textResult(id, text, isError);
      } catch (e) {
        textResult(id, (e as Error).message, true);
      }
      return;
    }
    default:
      if (id !== undefined) rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg: Json;
  try {
    msg = JSON.parse(t) as Json;
  } catch {
    return;
  }
  void handle(msg).catch((e) => {
    if (msg.id !== undefined) rpcErr(msg.id, -32603, (e as Error).message);
  });
});
rl.on("close", () => process.exit(0));

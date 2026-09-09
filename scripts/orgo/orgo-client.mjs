import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://www.orgo.ai/api";
const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(HERE, ".state.json");
const ENV_PATH = join(HERE, ".env");

export function loadEnv() {
  if (existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] == null) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

export function requireApiKey() {
  const key = process.env.ORGO_API_KEY;
  if (!key) {
    throw new Error(
      `ORGO_API_KEY is not set. Either:\n` +
      `  export ORGO_API_KEY=sk_live_...\n` +
      `  or put "ORGO_API_KEY=sk_live_..." in ${ENV_PATH}`
    );
  }
  return key;
}

function headers() {
  return { Authorization: `Bearer ${requireApiKey()}`, "Content-Type": "application/json" };
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: headers() });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) {
    throw new Error(`Orgo API ${response.status} ${path}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

export function readState() {
  return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
}

export function writeState(patch) {
  const state = { ...readState(), ...patch };
  mkdirSync(HERE, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

export async function ensureWorkspace() {
  const state = readState();
  if (state.workspaceId) return state.workspaceId;
  const existing = await api("/workspaces").catch(() => null);
  const found = Array.isArray(existing) ? existing.find((w) => w.name === "grok-bot-agents") : null;
  if (found) {
    writeState({ workspaceId: found.id });
    return found.id;
  }
  const created = await api("/workspaces", { method: "POST", body: JSON.stringify({ name: "grok-bot-agents" }) });
  writeState({ workspaceId: created.id });
  return created.id;
}

export async function ensureComputer({ ram = 4, cpu = 1, name = "agent-1" } = {}) {
  const state = readState();
  if (state.computerId) {
    const computer = await api(`/computers/${state.computerId}`).catch(() => null);
    if (computer && computer.status !== "deleted") return state.computerId;
  }
  const workspaceId = await ensureWorkspace();
  const created = await api("/computers", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, name, ram, cpu }),
  });
  writeState({ computerId: created.id, instanceId: created.instance_id ?? null });
  return created.id;
}

export async function runHostedAgent({ instruction, computerId, model, stream = true, onDelta }) {
  const response = await fetch("https://www.orgo.ai/api/v1/chat/completions", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: model || process.env.ORGO_MODEL || "claude-sonnet-5",
      computer_id: computerId,
      stream,
      messages: [{ role: "user", content: instruction }],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Orgo agent API ${response.status}: ${text.slice(0, 2000)}`);
  }
  if (!stream) {
    const body = await response.json();
    const content = body.choices?.[0]?.message?.content ?? JSON.stringify(body);
    if (onDelta) onDelta(content);
    return content;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          const delta =
            event.choices?.[0]?.delta?.content ??
            event.choices?.[0]?.message?.content ??
            event.delta ??
            "";
          if (delta) {
            full += delta;
            if (onDelta) onDelta(delta);
          }
        } catch {}
      }
    }
  }
  return full;
}

export const computers = {
  get: (id) => api(`/computers/${id}`),
  list: () => api("/computers"),
  start: (id) => api(`/computers/${id}/start`, { method: "POST" }),
  stop: (id) => api(`/computers/${id}/stop`, { method: "POST" }),
  restart: (id) => api(`/computers/${id}/restart`, { method: "POST" }),
  delete: (id) => api(`/computers/${id}`, { method: "DELETE" }),
  bash: (id, command) => api(`/computers/${id}/bash`, { method: "POST", body: JSON.stringify({ command }) }),
  click: (id, x, y) => api(`/computers/${id}/click`, { method: "POST", body: JSON.stringify({ x, y }) }),
  type: (id, text) => api(`/computers/${id}/type`, { method: "POST", body: JSON.stringify({ text }) }),
  key: (id, key) => api(`/computers/${id}/key`, { method: "POST", body: JSON.stringify({ key }) }),
  vncPassword: (id) => api(`/computers/${id}/vnc-password`),
  async screenshot(id, outPath) {
    const response = await fetch(`${API_BASE}/computers/${id}/screenshot`, { headers: headers() });
    if (!response.ok) throw new Error(`screenshot failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, bytes);
    }
    return bytes;
  },
};

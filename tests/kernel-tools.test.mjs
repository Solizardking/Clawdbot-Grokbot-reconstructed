import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "source/node-agent-coordinator/kernel-tools.ts");

async function loadKernelTools() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "kernel-tools-"));
  const output = path.join(temporary, "kernel-tools.mjs");
  await build({
    entryPoints: [sourcePath],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, method: body.method, notification: body.id === undefined });
    if (body.method === "initialize") {
      return response({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "kernel", version: "1" } } }, "session-123");
    }
    if (body.method === "notifications/initialized") return response(null);
    const handler = handlers[body.method];
    if (handler == null) throw new Error(`unexpected method ${body.method}`);
    return handler(body) ?? null;
  };
  impl.calls = calls;
  return impl;
}

function response(body, sessionId) {
  return {
    ok: true,
    status: 200,
    headers: { get: name => name.toLowerCase() === "mcp-session-id" ? sessionId ?? null : contentType(name.toLowerCase()) },
    json: async () => body,
    text: async () => "",
  };
}

function contentType() {
  return "application/json";
}

test("kernel bridge proxies MCP tools with a kernel_ prefix", async () => {
  const loaded = await loadKernelTools();
  const kernel = loaded.module;
  try {
  const fetchImpl = fakeFetch({
    "tools/list": body => response({ jsonrpc: "2.0", id: body.id, result: { tools: [
      { name: "manage_browsers", description: "Create and delete cloud browser sessions.", inputSchema: { type: "object", properties: { action: { type: "string" } }, required: ["action"] } },
      { name: "execute_playwright_code", description: "Run Playwright code in the session VM.", inputSchema: { type: "object" } },
    ] } }),
  });
  kernel.configureKernelBridgeForTests({ apiKey: "k_test", fetchImpl });

  const tools = await kernel.kernelRoutedTools();
  assert.deepEqual(tools.map(tool => tool.name), ["kernel_manage_browsers", "kernel_execute_playwright_code"]);
  assert.equal(tools[0].providerIdentifier, "kernel-cloud-browser");
  assert.equal(tools[0].inputSchema.required[0], "action");

  const cached = await kernel.kernelRoutedTools();
  assert.equal(cached.length, 2);
  assert.equal(fetchImpl.calls.filter(call => call.method === "tools/list").length, 1, "tool list is cached for five minutes");
  } finally { await loaded.dispose(); }
});

test("execution strips the prefix, sends the bare name, and unwraps content", async () => {
  const loaded = await loadKernelTools();
  const kernel = loaded.module;
  try {
  const fetchImpl = fakeFetch({
    "tools/list": body => response({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "manage_browsers", inputSchema: { type: "object" } }] } }),
    "tools/call": body => {
      assert.equal(body.params.name, "manage_browsers");
      assert.deepEqual(body.params.arguments, { action: "create" });
      return response({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ ok: true, session_id: "s1" }) }] } });
    },
  });
  kernel.configureKernelBridgeForTests({ apiKey: "k_test", fetchImpl });
  await kernel.kernelRoutedTools();
  const result = await kernel.executeKernelRoutedTool("kernel_manage_browsers", { action: "create" });
  assert.deepEqual(result, { ok: true, session_id: "s1" });
  assert.equal(kernel.isKernelRoutedTool("kernel_manage_browsers"), true);
  assert.equal(kernel.isKernelRoutedTool("manage_browsers"), false);} finally { await loaded.dispose(); }
});

test("missing key surfaces zero kernel tools and a helpful execution error", async () => {
  const loaded = await loadKernelTools();
  const kernel = loaded.module;
  try {
  assert.deepEqual(await kernel.kernelRoutedTools(), []);
  kernel.configureKernelBridgeForTests({ apiKey: undefined, fetchImpl: () => { throw new Error("no network"); } });
  assert.deepEqual(await kernel.kernelRoutedTools(), []);
  await assert.rejects(
    kernel.executeKernelRoutedTool("kernel_manage_browsers", {}),
    /KERNEL_API_KEY/,
  );} finally { await loaded.dispose(); }
});

test("mcp errors propagate as tool failures", async () => {
  const loaded = await loadKernelTools();
  const kernel = loaded.module;
  try {
  const fetchImpl = fakeFetch({
    "tools/list": body => response({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "computer_action", inputSchema: { type: "object" } }] } }),
    "tools/call": body => response({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "session not found" }] } }),
  });
  kernel.configureKernelBridgeForTests({ apiKey: "k_test", fetchImpl });
  await kernel.kernelRoutedTools();
  await assert.rejects(kernel.executeKernelRoutedTool("kernel_computer_action", {}), /session not found/);} finally { await loaded.dispose(); }
});

test("coordinator routes local interception through the shared executeLocalTool gate", async () => {
  const routerSource = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(routerSource, /from "\.\/kernel-tools\.js"/);
  assert.match(routerSource, /isKernelRoutedTool\(name\)\) return executeKernelRoutedTool/);
});

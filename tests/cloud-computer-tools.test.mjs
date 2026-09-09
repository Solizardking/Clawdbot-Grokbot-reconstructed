import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadToolModule(relativeSource, externals = []) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cloud-computer-tools-"));
  const output = path.join(temporary, `${path.basename(relativeSource).replace(/\.ts$/, "")}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, relativeSource)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    external: externals,
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
test('hosted E2B uses the user token and never falls back to a local SDK', async () => {
  const loaded = await loadToolModule('source/node-agent-coordinator/e2b-tools.ts');
  const originalUrl = process.env.SAND_HOSTED_GATEWAY_URL, originalToken = process.env.SAND_HOSTED_GATEWAY_TOKEN, originalFetch = globalThis.fetch;
  process.env.SAND_HOSTED_GATEWAY_URL = 'https://gateway.test';
  process.env.SAND_HOSTED_GATEWAY_TOKEN = 'a'.repeat(43);
  let calls = 0;
  try {
    loaded.module.configureE2bBridgeForTests({ apiKey: 'local-key', sdk: { create: async () => { throw new Error('must not use local SDK'); } } });
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, 'https://gateway.test/e2b/request');
      assert.equal(init.headers.authorization, `Bearer ${'a'.repeat(43)}`);
      assert.deepEqual(JSON.parse(init.body), { action: 'status', args: {} });
      assert.doesNotMatch(JSON.stringify(init), /local-key/);
      return { ok: false, status: 403 };
    };
    await assert.rejects(loaded.module.executeE2bRoutedTool('e2b_computer_status', {}), /HTTP 403/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SAND_HOSTED_GATEWAY_URL; else process.env.SAND_HOSTED_GATEWAY_URL = originalUrl;
    if (originalToken === undefined) delete process.env.SAND_HOSTED_GATEWAY_TOKEN; else process.env.SAND_HOSTED_GATEWAY_TOKEN = originalToken;
    await loaded.dispose();
  }
});

test('E2B accepts SDK classes and stopping never creates a sandbox or hides a failed kill', async () => {
  const loaded = await loadToolModule('source/node-agent-coordinator/e2b-tools.ts');
  const bridge = loaded.module;
  let creates = 0, kills = 0;
  class FakeDesktop {
    static async create() {
      creates++;
      return { sandboxId: 'owned', stream: { start: async () => {}, getUrl: () => 'https://view.example' },
        kill: async () => { kills++; if (kills === 1) throw new Error('kill failed'); } };
    }
  }
  try {
    bridge.configureE2bBridgeForTests({ apiKey: 'test-key', sdk: bridge.createDesktopSdkAdapter(FakeDesktop) });
    assert.deepEqual(await bridge.executeE2bRoutedTool('e2b_computer_stop', {}), { stopped: true });
    assert.equal(creates, 0);
    await bridge.executeE2bRoutedTool('e2b_computer_status', {});
    await assert.rejects(bridge.executeE2bRoutedTool('e2b_computer_stop', {}), /kill failed/);
    assert.deepEqual(await bridge.executeE2bRoutedTool('e2b_computer_stop', {}), { stopped: true });
    assert.equal(creates, 1);
    assert.equal(kills, 2);
  } finally { await loaded.dispose(); }
});

test('hosted Browser Use sends only a gateway token and does not fall back after rejection', async () => {
  const loaded = await loadToolModule('source/node-agent-coordinator/browser-use-tools.ts');
  const originalUrl = process.env.SAND_HOSTED_GATEWAY_URL, originalToken = process.env.SAND_HOSTED_GATEWAY_TOKEN;
  process.env.SAND_HOSTED_GATEWAY_URL = 'https://gateway.test';
  process.env.SAND_HOSTED_GATEWAY_TOKEN = 'a'.repeat(43);
  let calls = 0;
  try {
    loaded.module.configureBrowserUseBridgeForTests({ fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, 'https://gateway.test/browseruse/request');
      assert.equal(init.headers.authorization, `Bearer ${'a'.repeat(43)}`);
      assert.equal(init.headers['x-browser-use-api-key'], undefined);
      assert.deepEqual(JSON.parse(init.body), { method: 'PATCH', path: '/browsers/browser-a', body: { action: 'stop' } });
      return { ok: false, status: 403, json: async () => ({ error: 'Not enabled' }) };
    } });
    await assert.rejects(loaded.module.executeBrowserUseRoutedTool('browseruse_stop_browser', { id: 'browser-a' }), /Not enabled/);
    assert.equal(calls, 1);
  } finally {
    if (originalUrl === undefined) delete process.env.SAND_HOSTED_GATEWAY_URL; else process.env.SAND_HOSTED_GATEWAY_URL = originalUrl;
    if (originalToken === undefined) delete process.env.SAND_HOSTED_GATEWAY_TOKEN; else process.env.SAND_HOSTED_GATEWAY_TOKEN = originalToken;
    await loaded.dispose();
  }
});

function restFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const body = init.body == null ? null : JSON.parse(init.body);
    calls.push({ url, method: init.method, body });
    for (const [match, handler] of routes) if (match(url, init.method)) return await handler(body);
    throw new Error(`unexpected ${init.method} ${url}`);
  };
  impl.calls = calls;
  return impl;
}

test("browser use bridge hides tools without a key and explains how to fix execution", async () => {
  const loaded = await loadToolModule("source/node-agent-coordinator/browser-use-tools.ts");
  const bridge = loaded.module;
  try {
    bridge.configureBrowserUseBridgeForTests({ apiKey: undefined, fetchImpl: () => { throw new Error("no network"); }, sleepImpl: async () => {} });
    assert.deepEqual(bridge.browserUseRoutedTools(), []);
    await assert.rejects(bridge.executeBrowserUseRoutedTool("browseruse_run_task", { task: "x" }), /BROWSER_USE_API_KEY/);
  } finally { await loaded.dispose(); }
});

test("browser use run task polls status then returns the full run with a live view", async () => {
  const loaded = await loadToolModule("source/node-agent-coordinator/browser-use-tools.ts");
  const bridge = loaded.module;
  try {
    let statusPolls = 0;
    const fetchImpl = restFetch([
      [(url, method) => method === "POST" && url.endsWith("/runs"), body => {
        assert.equal(body.task, "Find the top Hacker News story");
        return ok({ id: "run_1", status: "created" });
      }],
      [(url, method) => method === "GET" && url.endsWith("/runs/run_1/status"), () => {
        statusPolls += 1;
        return ok({ id: "run_1", status: statusPolls >= 2 ? "completed" : "running" });
      }],
      [(url, method) => method === "GET" && url.endsWith("/runs/run_1"), () => ok({ id: "run_1", status: "completed", result: "Top story: Example", sessionId: "sess_1", session: { liveUrl: "https://live.example/run_1" } })],
    ]);
    bridge.configureBrowserUseBridgeForTests({ apiKey: "bu_test", fetchImpl, sleepImpl: async () => {} });

    const names = bridge.browserUseRoutedTools().map(tool => tool.name);
    assert.deepEqual(names, ["browseruse_session_status", "browseruse_cancel_task", "browseruse_run_task", "browseruse_task_status", "browseruse_task_result", "browseruse_follow_up", "browseruse_launch_browser", "browseruse_stop_browser"]);
    assert.equal(bridge.browserUseRoutedTools()[0].providerIdentifier, "grok-bot-local-browser-use");

    const result = await bridge.executeBrowserUseRoutedTool("browseruse_run_task", { task: "Find the top Hacker News story", poll_interval_seconds: 2 });
    assert.equal(result.result, "Top story: Example");
    assert.equal(result.liveUrl, "https://live.example/run_1");
    assert.equal(statusPolls, 2);
  } finally { await loaded.dispose(); }
});

test("browser use background start, follow-ups, and browser lifecycle map to API v4 routes", async () => {
  const loaded = await loadToolModule("source/node-agent-coordinator/browser-use-tools.ts");
  const bridge = loaded.module;
  try {
    const fetchImpl = restFetch([
      [(url, method) => method === "POST" && url.endsWith("/runs"), () => ok({ id: "run_2", status: "created" })],
      [url => url.endsWith("/sessions/sess_1/queue"), body => {
        assert.equal(body.text, "Now open the top result");
        return ok({ queued: true });
      }],
      [(url, method) => method === "POST" && url.endsWith("/browsers"), body => {
        assert.equal(body.proxyCountryCode, "us");
        return ok({ id: "b_1", cdpUrl: "wss://cdp.example/b_1" });
      }],
      [(url, method) => method === "PATCH" && url.endsWith("/browsers/b_1"), body => {
        assert.equal(body.action, "stop");
        return ok({ stopped: true });
      }],
    ]);
    bridge.configureBrowserUseBridgeForTests({ apiKey: "bu_test", fetchImpl, sleepImpl: async () => {} });

    const started = await bridge.executeBrowserUseRoutedTool("browseruse_run_task", { task: "Watch this page", wait: false });
    assert.equal(started.id, "run_2");
    assert.match(started.note, /browseruse_task_status/);

    const followUp = await bridge.executeBrowserUseRoutedTool("browseruse_follow_up", { session_id: "sess_1", text: "Now open the top result" });
    assert.deepEqual(followUp, { queued: true });

    const launched = await bridge.executeBrowserUseRoutedTool("browseruse_launch_browser", {});
    assert.equal(launched.cdpUrl, "wss://cdp.example/b_1");

    const stopped = await bridge.executeBrowserUseRoutedTool("browseruse_stop_browser", { id: "b_1" });
    assert.deepEqual(stopped, { stopped: true });

    assert.equal(bridge.isBrowserUseRoutedTool("browseruse_launch_browser"), true);
    assert.equal(bridge.isBrowserUseRoutedTool("other_tool"), false);
  } finally { await loaded.dispose(); }
});

function fakeDesktopSdk(log) {
  let createOptions = null;
  const sandbox = {
    sandboxId: "sbx_test_123",
    screenshot: async () => new Uint8Array([137, 80, 78, 71, 10]),
    leftClick: async (x, y) => log.push(["leftClick", x, y]),
    doubleClick: async (x, y) => log.push(["doubleClick", x, y]),
    rightClick: async (x, y) => log.push(["rightClick", x, y]),
    middleClick: async (x, y) => log.push(["middleClick", x, y]),
    moveMouse: async (x, y) => log.push(["moveMouse", x, y]),
    drag: async (from, to) => log.push(["drag", [...from], [...to]]),
    write: async text => log.push(["write", text]),
    press: async keys => log.push(["press", keys]),
    scroll: async (direction, amount) => log.push(["scroll", direction, amount]),
    commands: { run: async command => { log.push(["run", command]); return { stdout: "hello\n", stderr: "", exitCode: 0 }; } },
    stream: { start: async () => log.push(["stream.start"]), getUrl: () => "https://vnc.example/sbx_test_123" },
    setTimeout: async ms => log.push(["setTimeout", ms]),
    kill: async () => log.push(["kill"]),
  };
  return {
    getCreateOptions: () => createOptions,
    sdk: {
      create: async options => {
        createOptions = options;
        return sandbox;
      },
    },
  };
}

test("e2b bridge boots one desktop session and drives mouse, keyboard, screen and shell", async () => {
  const loaded = await loadToolModule("source/node-agent-coordinator/e2b-tools.ts", ["@e2b/desktop"]);
  const e2b = loaded.module;
  const log = [];
  const fake = fakeDesktopSdk(log);
  try {
    e2b.configureE2bBridgeForTests({ apiKey: undefined, sdk: fake.sdk });
    assert.deepEqual(e2b.e2bRoutedTools(), []);

    e2b.configureE2bBridgeForTests({ apiKey: "e2b_test", sdk: fake.sdk });
    const names = e2b.e2bRoutedTools().map(tool => tool.name);
    assert.deepEqual(names, [
      "e2b_computer_status", "e2b_computer_screenshot", "e2b_computer_click", "e2b_computer_type",
      "e2b_computer_key", "e2b_computer_scroll", "e2b_computer_drag", "e2b_computer_run_command", "e2b_computer_stop",
    ]);
    assert.equal(e2b.e2bRoutedTools()[0].providerIdentifier, "grok-bot-local-e2b-desktop");

    const status = await e2b.executeE2bRoutedTool("e2b_computer_status", {});
    assert.equal(fake.getCreateOptions().apiKey, "e2b_test");
    assert.equal(fake.getCreateOptions().resolution.length, 2);
    assert.equal(status.sandboxId, "sbx_test_123");
    assert.equal(status.streamUrl, "https://vnc.example/sbx_test_123");

    const screenshot = await e2b.executeE2bRoutedTool("e2b_computer_screenshot", {});
    assert.equal(screenshot.format, "png");
    assert.ok(Buffer.from(screenshot.image_base64, "base64").includes(137));

    await e2b.executeE2bRoutedTool("e2b_computer_click", { x: 12.4, y: 30.6 });
    await e2b.executeE2bRoutedTool("e2b_computer_click", { x: 5, y: 5, count: 2 });
    await e2b.executeE2bRoutedTool("e2b_computer_click", { x: 7, y: 7, button: "right" });
    await e2b.executeE2bRoutedTool("e2b_computer_type", { text: "hello world" });
    await e2b.executeE2bRoutedTool("e2b_computer_key", { keys: "ctrl+c" });
    await e2b.executeE2bRoutedTool("e2b_computer_scroll", { direction: "up", amount: 4 });
    await e2b.executeE2bRoutedTool("e2b_computer_drag", { from_x: 0, from_y: 0, to_x: 100, to_y: 50 });
    const command = await e2b.executeE2bRoutedTool("e2b_computer_run_command", { command: "echo hello" });

    const actions = log.filter(entry => entry[0] !== "setTimeout");
    assert.deepEqual(actions.slice(0, 8), [
      ["stream.start"],
      ["leftClick", 12, 31], ["doubleClick", 5, 5], ["rightClick", 7, 7],
      ["write", "hello world"], ["press", "ctrl+c"], ["scroll", "up", 4], ["drag", [0, 0], [100, 50]],
    ]);
    assert.ok(log.filter(entry => entry[0] === "setTimeout" && entry[1] === 15 * 60_000).length >= 2, "each action extends the sandbox lease");
    assert.deepEqual(command, { exitCode: 0, stdout: "hello\n", stderr: "" });

    await e2b.executeE2bRoutedTool("e2b_computer_stop", {});
    assert.deepEqual(log.at(-1), ["kill"]);
  } finally { await loaded.dispose(); }
});

test("coordinator router registers both cloud tool families in its local dispatch gate", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(source, /from "\.\/browser-use-tools\.js"/);
  assert.match(source, /from "\.\/e2b-tools\.js"/);
  assert.match(source, /isE2bRoutedTool\(name\)\) return executeE2bRoutedTool/);
  assert.match(source, /isBrowserUseRoutedTool\(name\)\) return executeBrowserUseRoutedTool/);
  assert.match(source, /\.\.\.e2bRoutedTools\(\), \.\.\.browserUseRoutedTools\(\)/);
});

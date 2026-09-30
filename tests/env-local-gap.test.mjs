import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import test from "node:test";

import { build } from "esbuild";
import { createGateway } from "../services/provider-gateway/server.mjs";
import { solanaTrackerEndpoint } from "../services/provider-gateway/solana-tracker.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".cache");
mkdirSync(cacheDir, { recursive: true });

const CANONICAL = Object.freeze({
  OPENROUTER_API_KEY: "OPENROUTER_API_KEY",
  XAI_API_KEY: "XAI_API_KEY",
  HELIUS_API_KEY: "HELIUS_API_KEY",
  BROWSER_USE_API_KEY: "BROWSER_USE_API_KEY",
  PAYBOX_SIGNING_KEY: "PAYBOX_SIGNING_KEY",
  PAYBOX_API_KEY: "PAYBOX_API_KEY",
  PUMP_MCP_TOKEN: "PUMP_MCP_TOKEN",
  GATEWAY_USERS_JSON: "GATEWAY_USERS_JSON",
  GATEWAY_DATABASE_PATH: "GATEWAY_DATABASE_PATH",
  DEEPGRAM_API_KEY: "DEEPGRAM_API_KEY",
});
const ALIASES = Object.freeze({
  SOLGPT_API_KEY: CANONICAL.OPENROUTER_API_KEY,
  BROWSERUSE_API_KEY: CANONICAL.BROWSER_USE_API_KEY,
  HELIUS_RPC_URL: CANONICAL.HELIUS_API_KEY,
  SOLGPT_PUMP_MCP_TOKEN: CANONICAL.PUMP_MCP_TOKEN,
});

function envPresence(file) {
  if (!existsSync(file)) return { exists: false, names: new Map() };
  const parsed = parseEnv(readFileSync(file, "utf8"));
  const names = new Map();
  for (const [key, raw] of Object.entries(parsed)) {
    names.set(key, String(raw ?? "").trim().length === 0 ? "empty" : "set");
  }
  return { exists: true, names };
}

function dummyFromNames(presence) {
  const env = {};
  for (const [key, state] of presence.names) env[key] = state === "set" ? `dummy-${key}` : "";
  return env;
}

function assignmentRuns(file) {
  const runs = new Map();
  if (!existsSync(file)) return runs;
  for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const list = runs.get(match[1]) ?? [];
    list.push({ line: index + 1, empty: match[2].trim() === "" });
    runs.set(match[1], list);
  }
  return runs;
}

async function loadSource(relative, extra = {}) {
  const outfile = path.join(cacheDir, `env-gap-${relative.replace(/[^A-Za-z0-9._-]+/g, "__")}.mjs`);
  await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, relative)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    outfile,
    logLevel: "silent",
    ...extra,
  });
  return import(`${pathToFileURL(outfile).href}?${Date.now()}`);
}

const legacyEnv = Object.freeze({
  SOLGPT_API_KEY: "dummy-solgpt",
  BROWSERUSE_API_KEY: "dummy-browseruse",
  HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=dummy-helius",
  SOLGPT_PUMP_MCP_TOKEN: "dummy-pump",
  TELEGRAM_BOT_TOKEN: "dummy-telegram-token",
  TAVILY_API_KEY: "dummy-tavily",
  COMPOSIO_API_KEY: "dummy-composio",
  E2B_API_KEY: "dummy-e2b",
});

test("private env files are absent from the publishable tree and legacy names have canonical owners", () => {
  for (const relative of [".env", ".env.local", "clawd/.env", "clawd/deploy/.env", "clawd/deploy/openrouter.env"]) {
    assert.equal(existsSync(path.join(repoRoot, relative)), false, relative);
  }
  assert.equal(ALIASES.SOLGPT_API_KEY, CANONICAL.OPENROUTER_API_KEY);
  assert.equal(ALIASES.BROWSERUSE_API_KEY, CANONICAL.BROWSER_USE_API_KEY);
  assert.equal(ALIASES.HELIUS_RPC_URL, CANONICAL.HELIUS_API_KEY);
  assert.equal(ALIASES.SOLGPT_PUMP_MCP_TOKEN, CANONICAL.PUMP_MCP_TOKEN);
});

test("npm start scripts load .env, not .env.local, and the root .env file is missing", () => {
  const rootScripts = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
  const clawdScripts = JSON.parse(readFileSync(path.join(repoRoot, "clawd/package.json"), "utf8")).scripts;
  assert.match(rootScripts["gateway:start"], /--env-file-if-exists=\.env /);
  assert.doesNotMatch(rootScripts["gateway:start"], /\.env\.local/);
  assert.match(rootScripts["clawd:server"], /--env-file-if-exists=\.env /);
  assert.doesNotMatch(rootScripts["clawd:server"], /\.env\.local/);
  assert.match(clawdScripts["dev:server"], /--env-file-if-exists=\.env /);
  assert.doesNotMatch(clawdScripts["dev:server"], /\.env\.local/);
  assert.match(clawdScripts["dev:harness"], /--env-file-if-exists=\.env /);
  assert.doesNotMatch(clawdScripts["dev:harness"], /\.env\.local/);
  const electronMain = readFileSync(path.join(repoRoot, "clawd/electron/main.mjs"), "utf8");
  assert.match(electronMain, /loadEnvFile\(new URL\("\.\.\/\.env"/);
  assert.doesNotMatch(electronMain, /\.env\.local/);
  assert.equal(existsSync(path.join(repoRoot, ".env")), false);
});

test("createGateway accepts the legacy OpenRouter alias when canonical keys are absent", () => {
  const token = "a".repeat(43);
  const digest = createHash("sha256").update(token).digest("hex");
  const env = {
    ...legacyEnv,
    GATEWAY_DATABASE_PATH: ":memory:",
    GATEWAY_USERS_JSON: JSON.stringify({ [digest]: { id: "alice", models: ["allowed"] } }),
  };
  assert.equal(Boolean(env.SOLGPT_API_KEY), true);
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  assert.equal(env.XAI_API_KEY, undefined);
  assert.doesNotThrow(() => createGateway({ env }));
});

test("gateway account listing recognizes supported legacy aliases without exposing private keys", async (t) => {
  const token = "a".repeat(43);
  const digest = createHash("sha256").update(token).digest("hex");
  const env = {
    ...legacyEnv,
    GATEWAY_DATABASE_PATH: ":memory:",
    GATEWAY_USERS_JSON: JSON.stringify({
      [digest]: {
        id: "alice",
        models: ["allowed"],
        services: ["helius", "browseruse", "e2b", "media", "tavily", "composio", "solana", "pump", "birdeye"],
      },
    }),
  };
  const server = createGateway({ env, fetchImpl: async () => { throw new Error("no network"); } });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/account`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.services.sort(), ["browseruse", "composio", "e2b", "helius", "media", "pump", "tavily"]);
  assert.equal(solanaTrackerEndpoint({ SOLANA_TRACKER_RPC_URL: "dummy-SOLANA_TRACKER_RPC_URL" }), null);
});

test("Telegram Fly turn runner accepts SOLGPT_API_KEY as the OpenRouter compatibility alias", async () => {
  const fly = await loadSource("source/services/telegram-fly/server.ts");
  const previous = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    SOLGPT_API_KEY: process.env.SOLGPT_API_KEY,
  };
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.XAI_API_KEY;
  process.env.SOLGPT_API_KEY = "dummy-solgpt";
  try {
    assert.equal(fly.resolveHeadlessProvider({ SOLGPT_API_KEY: "dummy-solgpt" }), "openrouter");
    const runTurn = fly.createHeadlessTurnRunner({
      provider: "openrouter",
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    assert.equal(await runTurn("hi"), "ok");
    const xaiTurn = fly.createHeadlessTurnRunner({
      provider: "xai",
      fetchImpl: async () => { throw new Error("should not fetch"); },
    });
    await assert.rejects(xaiTurn("hi"), /xAI needs XAI_API_KEY/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Telegram bridge config treats HELIUS_RPC_URL as Helius and SOLGPT_API_KEY as OpenRouter", async () => {
  const server = await loadSource("source/telegram-bridge-server/main.ts");
  const fromLocalNames = server.resolveBridgeEnvConfig(legacyEnv);
  assert.equal(fromLocalNames.openRouterConfigured, true);
  assert.equal(fromLocalNames.heliusConfigured, true);
  assert.equal(fromLocalNames.deepgramConfigured, false);
  assert.equal(typeof fromLocalNames.token, "string");
  assert.equal(fromLocalNames.token.length > 0, true);
  const empty = server.resolveBridgeEnvConfig({});
  assert.equal(empty.openRouterConfigured, false);
  assert.equal(empty.heliusConfigured, false);
  assert.equal(server.resolveBridgeEnvConfig({ OPENROUTER_API_KEY: "sk-or-v1-abc" }).openRouterConfigured, true);
});

test("Browser Use coordinator accepts BROWSERUSE_API_KEY; gateway does not", async () => {
  const browser = await loadSource("source/node-agent-coordinator/browser-use-tools.ts");
  const previousUse = process.env.BROWSER_USE_API_KEY;
  const previousAlias = process.env.BROWSERUSE_API_KEY;
  delete process.env.BROWSER_USE_API_KEY;
  delete process.env.BROWSERUSE_API_KEY;
  try {
    browser.configureBrowserUseBridgeForTests({ apiKey: undefined, fetchImpl: async () => { throw new Error("no network"); } });
    await assert.rejects(
      browser.executeBrowserUseRoutedTool("browseruse_run_task", { task: "x" }),
      /Set BROWSER_USE_API_KEY \(or BROWSERUSE_API_KEY\)/,
    );
    const isolated = { SAND_HOSTED_GATEWAY_URL: "", SAND_HOSTED_GATEWAY_TOKEN: "" };
    assert.equal(browser.browserUseApiKey({ ...isolated, BROWSERUSE_API_KEY: "alias-key" }), "alias-key");
    assert.equal(browser.browserUseApiKey({ ...isolated, BROWSER_USE_API_KEY: "canonical-key" }), "canonical-key");
  } finally {
    browser.configureBrowserUseBridgeForTests(null);
    if (previousUse == null) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousUse;
    if (previousAlias == null) delete process.env.BROWSERUSE_API_KEY;
    else process.env.BROWSERUSE_API_KEY = previousAlias;
  }
});

test("resolveSolanaBotEnv derives HELIUS_RPC_URL from HELIUS_API_KEY and keeps an explicit RPC URL", async () => {
  const env = await loadSource("source/shared/solana-bot-env.ts");
  const fromKey = await env.resolveSolanaBotEnv({ env: { HELIUS_API_KEY: "hel-key" } });
  assert.equal(fromKey.HELIUS_API_KEY, "hel-key");
  assert.equal(fromKey.HELIUS_RPC_URL, env.deriveHeliusRpcUrl("hel-key"));
  const fromUrl = await env.resolveSolanaBotEnv({ env: { HELIUS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=x" } });
  assert.equal(fromUrl.HELIUS_RPC_URL, "https://mainnet.helius-rpc.com/?api-key=x");
  const missing = await env.resolveSolanaBotEnv({ env: {} });
  assert.equal(missing.HELIUS_RPC_URL, undefined);
  assert.equal(missing.HELIUS_API_KEY, undefined);
});

test("PayBox stays disconnected without PAYBOX_SIGNING_KEY or PAYBOX_API_KEY", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "env-gap-paybox-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outfile = path.join(dir, "paybox.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/node-agent-coordinator/paybox-tools.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
    banner: { js: 'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);' },
  });
  const { createPayboxTools } = await import(pathToFileURL(outfile).href);
  const api = createPayboxTools({
    locked: (work) => work(),
    resolveCredentials: async () => ({ token: undefined, signingKey: undefined }),
    fetchImpl: async () => { throw new Error("PayBox must not be called without credentials"); },
  });
  const listed = await api.list();
  assert.deepEqual(listed.map((tool) => tool.name), ["paybox_status"]);
  const status = await api.execute("paybox_status", {});
  assert.equal(status.authenticated, false);
  assert.match(status.setup, /PAYBOX_SIGNING_KEY/);
});

test("named Clawd deploy recipes are labeled and publish without private env files", () => {
  const compose = readFileSync(path.join(repoRoot, "clawd/deploy/docker-compose.yml"), "utf8");
  assert.match(compose, /^# LEGACY:/m);
  assert.match(compose, /ghcr\.io\/milind-soni\/openmausbot:latest/);
  assert.match(compose, /grep -q openmausbot/);
  const product = readFileSync(path.join(repoRoot, "clawd/shared/product.ts"), "utf8");
  assert.match(product, /export const PRODUCT_ID = "clawdbot"/);
  const localDocker = readFileSync(path.join(repoRoot, "clawd/deploy/local/Dockerfile"), "utf8");
  assert.match(localDocker, /ghcr\.io\/milind-soni\/openmausbot:latest/);
  const localReadme = readFileSync(path.join(repoRoot, "clawd/deploy/local/README.md"), "utf8");
  assert.match(localReadme, /Historical upstream recipe/);
  const bridgeDocker = readFileSync(path.join(repoRoot, "clawd/deploy/telegram-bridge/Dockerfile"), "utf8");
  assert.match(bridgeDocker, /COPY server\.cjs/);
  assert.equal(existsSync(path.join(repoRoot, "clawd/deploy/telegram-bridge/server.cjs")), false);
  const fly = readFileSync(path.join(repoRoot, "clawd/deploy/telegram-bridge/fly.toml"), "utf8");
  assert.match(fly, /SAND_TELEGRAM_AUTOSTART = "1"/);
  assert.doesNotMatch(fly, /OPENROUTER_API_KEY/);
  const container = readFileSync(path.join(repoRoot, "clawd/deploy/podman/Containerfile"), "utf8");
  assert.match(container, /uname -m.*" = x86_64/);
  assert.match(container, /requires Linux x86_64/);
  const podmanCompose = readFileSync(path.join(repoRoot, "clawd/deploy/podman/compose.yaml"), "utf8");
  assert.match(podmanCompose, /OMB_DATA_ROOT:\?Run setup\.sh first/);
  assert.match(podmanCompose, /PODMAN_SOCKET:\?Run setup\.sh first/);
  assert.match(podmanCompose, /app!=='clawdbot'/);
  const caddy = readFileSync(path.join(repoRoot, "clawd/deploy/Caddyfile"), "utf8");
  assert.match(caddy, /\{\$DOMAIN\}/);
  assert.equal(existsSync(path.join(repoRoot, "clawd/deploy/.env")), false);
  assert.equal(existsSync(path.join(repoRoot, "clawd/deploy/openrouter.env")), false);
  const podmanExample = envPresence(path.join(repoRoot, "clawd/deploy/podman/.env.example"));
  assert.equal(podmanExample.names.get("OMB_DATA_ROOT"), "set");
  assert.equal(podmanExample.names.has("OPENROUTER_API_KEY"), false);
  assert.equal(ALIASES.SOLGPT_API_KEY, CANONICAL.OPENROUTER_API_KEY);
});

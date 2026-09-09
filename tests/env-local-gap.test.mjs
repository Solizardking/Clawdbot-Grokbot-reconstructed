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

const envLocalPath = path.join(repoRoot, ".env.local");
const envLocal = envPresence(envLocalPath);

test(".env.local has aliases for OpenRouter / Browser Use / Helius / Pump, not the canonical names the runtimes read", () => {
  assert.equal(envLocal.exists, true);
  assert.equal(envLocal.names.get("SOLGPT_API_KEY"), "set");
  assert.equal(envLocal.names.has(CANONICAL.OPENROUTER_API_KEY), false);
  assert.equal(envLocal.names.get("BROWSERUSE_API_KEY"), "set");
  assert.equal(envLocal.names.has(CANONICAL.BROWSER_USE_API_KEY), false);
  assert.equal(envLocal.names.get("HELIUS_RPC_URL"), "set");
  assert.equal(envLocal.names.has(CANONICAL.HELIUS_API_KEY), false);
  assert.equal(envLocal.names.get("SOLGPT_PUMP_MCP_TOKEN"), "set");
  assert.equal(envLocal.names.has(CANONICAL.PUMP_MCP_TOKEN), false);
  for (const name of [
    CANONICAL.XAI_API_KEY,
    CANONICAL.PAYBOX_SIGNING_KEY,
    CANONICAL.PAYBOX_API_KEY,
    CANONICAL.GATEWAY_USERS_JSON,
    CANONICAL.GATEWAY_DATABASE_PATH,
    CANONICAL.DEEPGRAM_API_KEY,
  ]) {
    assert.equal(envLocal.names.has(name), false, name);
  }
  assert.equal(envLocal.names.get("BROWSERUSE_BOX_ID"), "empty");
  assert.equal(envLocal.names.get("BROWSERUSE_PROJECT_ID"), "empty");
  assert.equal(envLocal.names.get("CLAWD_WHITELIST_WALLETS"), "empty");
  assert.equal(envLocal.names.get("TELEGRAM_BOT_TOKEN"), "set");
  assert.equal(envLocal.names.get("TAVILY_API_KEY"), "set");
  assert.equal(envLocal.names.get("COMPOSIO_API_KEY"), "set");
  assert.equal(envLocal.names.get("E2B_API_KEY"), "set");
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

test("createGateway rejects an env shaped like .env.local because OpenRouter/xAI keys are absent", () => {
  const token = "a".repeat(43);
  const digest = createHash("sha256").update(token).digest("hex");
  const env = {
    ...dummyFromNames(envLocal),
    GATEWAY_DATABASE_PATH: ":memory:",
    GATEWAY_USERS_JSON: JSON.stringify({ [digest]: { id: "alice", models: ["allowed"] } }),
  };
  assert.equal(Boolean(env.SOLGPT_API_KEY), true);
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  assert.equal(env.XAI_API_KEY, undefined);
  assert.throws(() => createGateway({ env }), /Configure at least one provider API key/);
});

test("gateway account listing ignores BROWSERUSE_API_KEY, HELIUS_RPC_URL, and SOLGPT_PUMP_MCP_TOKEN aliases", async (t) => {
  const token = "a".repeat(43);
  const digest = createHash("sha256").update(token).digest("hex");
  const env = {
    ...dummyFromNames(envLocal),
    OPENROUTER_API_KEY: "dummy-openrouter-boot",
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
  assert.deepEqual(payload.services.sort(), ["composio", "e2b", "media", "tavily"]);
  assert.equal(payload.services.includes("browseruse"), false);
  assert.equal(payload.services.includes("helius"), false);
  assert.equal(payload.services.includes("pump"), false);
  assert.equal(solanaTrackerEndpoint({ SOLANA_TRACKER_RPC_URL: "dummy-SOLANA_TRACKER_RPC_URL" }), null);
});

test("Telegram Fly turn runner requires OPENROUTER_API_KEY even when SOLGPT_API_KEY is set", async () => {
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
      fetchImpl: async () => { throw new Error("should not fetch"); },
    });
    await assert.rejects(runTurn("hi"), /OpenRouter needs OPENROUTER_API_KEY/);
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

test("Telegram bridge config treats HELIUS_RPC_URL as enough for Helius but SOLGPT_API_KEY is not OpenRouter", async () => {
  const server = await loadSource("source/telegram-bridge-server/main.ts");
  const fromLocalNames = server.resolveBridgeEnvConfig(dummyFromNames(envLocal));
  assert.equal(fromLocalNames.openRouterConfigured, false);
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

test("named Clawd deploy recipes are legacy, incomplete, or host-blocked", () => {
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
  const deployEnv = envPresence(path.join(repoRoot, "clawd/deploy/.env"));
  assert.equal(deployEnv.names.get("DOMAIN"), "set");
  const domainLine = readFileSync(path.join(repoRoot, "clawd/deploy/.env"), "utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("DOMAIN="));
  assert.equal(domainLine, "DOMAIN=maus.example.com");
  const caddy = readFileSync(path.join(repoRoot, "clawd/deploy/Caddyfile"), "utf8");
  assert.match(caddy, /\{\$DOMAIN\}/);
  const openrouterEnv = path.join(repoRoot, "clawd/deploy/openrouter.env");
  const runs = assignmentRuns(openrouterEnv);
  assert.ok((runs.get("OPENROUTER_API_KEY") ?? []).length >= 3);
  assert.ok((runs.get("COMPOSIO_API_KEY") ?? []).length >= 2);
  const parsed = parseEnv(readFileSync(openrouterEnv, "utf8"));
  const rawKeys = [...runs.entries()].filter(([, list]) => list.length > 1).map(([key]) => key);
  assert.ok(rawKeys.includes("OPENROUTER_API_KEY"));
  const firstOpenRouter = readFileSync(openrouterEnv, "utf8").split(/\r?\n/).filter((line) => /^OPENROUTER_API_KEY=/.test(line));
  assert.equal(new Set(firstOpenRouter).size > 1, true, "OPENROUTER_API_KEY assignments conflict");
  const firstComposio = readFileSync(openrouterEnv, "utf8").split(/\r?\n/).filter((line) => /^COMPOSIO_API_KEY=/.test(line));
  assert.equal(new Set(firstComposio).size > 1, true, "COMPOSIO_API_KEY assignments conflict");
  assert.equal(typeof parsed.OPENROUTER_API_KEY, "string");
  assert.equal(ALIASES.SOLGPT_API_KEY, CANONICAL.OPENROUTER_API_KEY);
});

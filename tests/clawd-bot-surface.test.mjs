import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LISTED_TREES = [
  "apps",
  "build",
  "cloudflare",
  "companion",
  "dist-native",
  "docs",
  "electron",
  "ios",
  "public",
  "scripts",
  "server",
  "shared",
  "skills",
  "src",
  "third_party",
  "tools",
];

const LISTED_ROOT_FILES = [
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "electron-builder.yml",
  "index.html",
  "LICENSE",
  "mascot-preview.html",
  "NOTICE",
  "package.json",
  "package-lock.json",
  "docs/reconstruction/pnpm-lock.yaml",
  "docs/reconstruction/pnpm-workspace.yaml",
  "README.md",
  "SECURITY.md",
  "tsconfig.companion.build.json",
  "tsconfig.json",
  "tsconfig.server.build.json",
  "tsconfig.server.json",
  "vite.config.ts",
];

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "clawd-surface-"));
  const output = path.join(temporary, `${path.basename(entry, path.extname(entry))}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    banner: { js: `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);` },
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("listed OpenMausBot trees exist as adapted Clawd Bot source", () => {
  for (const tree of LISTED_TREES) {
    const full = path.join(repoRoot, "clawd", tree);
    assert.equal(existsSync(full), true, `missing adapted tree clawd/${tree}`);
  }
  for (const file of LISTED_ROOT_FILES) {
    const full = path.join(repoRoot, "clawd", file);
    assert.equal(existsSync(full), true, `missing adapted file clawd/${file}`);
  }
  const html = readFileSync(path.join(repoRoot, "clawd/index.html"), "utf8");
  assert.doesNotMatch(html, /OpenMausBot/);
  const builder = readFileSync(path.join(repoRoot, "clawd/electron-builder.yml"), "utf8");
  assert.match(builder, /productName: Clawd Bot/);
  assert.doesNotMatch(builder, /productName: OpenMausBot/);
});

test("shipped product strings are Clawd Bot", async () => {
  const loaded = await loadModule("clawd/shared/product.ts");
  try {
    assert.equal(loaded.module.PRODUCT_NAME, "Clawd Bot");
    assert.equal(loaded.module.PRODUCT_TITLE, "Clawd Bot");
    assert.equal(loaded.module.PRODUCT_MASCOT, "Clawd");
    assert.equal(loaded.module.PRODUCT_ID, "clawdbot");
    assert.doesNotMatch(loaded.module.PRODUCT_NAME, /OpenMausBot|Maus|Grok Bot/);
    const html = readFileSync(path.join(repoRoot, "clawd/index.html"), "utf8");
    assert.match(html, /<title>Clawd Bot<\/title>/);
    const onboarding = readFileSync(path.join(repoRoot, "clawd/src/components/Onboarding.tsx"), "utf8");
    assert.match(onboarding, /INTRO_HEADING/);
    assert.doesNotMatch(onboarding, /Meet Clawd Bot/);
    assert.doesNotMatch(onboarding, /Give each Bot a job/);
    assert.doesNotMatch(onboarding, /Welcome to \{PRODUCT_NAME\}/);
    assert.doesNotMatch(onboarding, /OpenMausBot/);
    assert.equal(loaded.module.INTRO_HEADING, "Clawd Bot on Solana");
    const preview = readFileSync(path.join(repoRoot, "clawd/mascot-preview.html"), "utf8");
    assert.match(preview, /<title>Clawd Motion Library<\/title>/);
  } finally {
    await loaded.dispose();
  }
});

test("Solana skin is the first-paint default with cluster tokens", async () => {
  const loaded = await loadModule("clawd/src/lib/skins.ts");
  try {
    assert.equal(loaded.module.DEFAULT_SKIN, "solana");
    assert.equal(loaded.module.SKINS.some((skin) => skin.id === "solana"), true);
    const css = readFileSync(path.join(repoRoot, "clawd/src/styles.css"), "utf8");
    const body = css.match(/\[data-skin="solana"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.match(body, /#9945FF/);
    assert.match(body, /#14F195/);
    assert.match(css, /--color-accent:\s*#14F195/);
    assert.match(css, /--color-accent-border:\s*#9945FF/);
    const html = readFileSync(path.join(repoRoot, "clawd/index.html"), "utf8");
    assert.match(html, /data-skin="solana"/);
  } finally {
    await loaded.dispose();
  }
});

test("shipped Solana service returns a real status object", async () => {
  const loaded = await loadModule("clawd/server/solana/solana-service.ts");
  try {
    const service = loaded.module.createSolanaService({
      revealSecret: async () => null,
      readRegistry: async () => ({ schemaVersion: 1, wallets: [] }),
      writeRegistry: async () => {},
      loadServerSdk: async () => ({ ServerSDK: class {} }),
    });
    const status = await service.getStatus();
    assert.equal(status.phantomConfigured, false);
    assert.equal(status.heliusConfigured, false);
    assert.equal(Array.isArray(status.missingPhantom), true);
    assert.equal(status.missingPhantom.length, 3);
    assert.equal(status.walletCount, 0);
    const listed = await service.listWallets();
    assert.equal(Array.isArray(listed.wallets), true);
  } finally {
    await loaded.dispose();
  }
});

test("shipped local wallet helper returns a real Solana address", async () => {
  const loaded = await loadModule("clawd/server/solana/local-wallets.ts");
  try {
    const pair = loaded.module.solanaKeypairFromSeed(Buffer.alloc(32, 7));
    assert.equal(typeof pair.address, "string");
    assert.match(pair.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.equal(typeof pair.secretKeyBase58, "string");
  } finally {
    await loaded.dispose();
  }
});

test("shipped routed Solana tool returns a real wallet list", async () => {
  const loaded = await loadModule("clawd/server/solana/solana-routed-tools.ts");
  try {
    assert.equal(loaded.module.isSolanaRoutedTool("solana_list_wallets"), true);
    const result = await loaded.module.executeSolanaRoutedTool(
      {
        listWallets: async () => ({
          wallets: [{ name: "ops", solanaAddress: "5XYzQ2c9T2Zy2h86mVYdGZ6cdYFe7LZAUdYc1r3sJmZK" }],
        }),
        getWalletAssets: async () => ({}),
        getAsset: async () => ({}),
        searchAssets: async () => ({}),
      },
      "solana_list_wallets",
      {},
    );
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.wallets[0].name, "ops");
  } finally {
    await loaded.dispose();
  }
});

test("adapted harness server health body is Clawd Bot structured data", async () => {
  const loaded = await loadModule("clawd/server/harness-entry.ts");
  const server = loaded.module.createHarnessServer();
  try {
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const body = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${address.port}/api/health`, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
              reject(error);
            }
          });
        })
        .on("error", reject);
    });
    assert.equal(body.name, "Clawd Bot");
    assert.equal(body.app, "clawdbot");
    assert.equal(typeof body.pid, "number");
    assert.equal(typeof body.solana.phantomConfigured, "boolean");
    assert.equal(typeof body.solana.heliusConfigured, "boolean");
    assert.notEqual(JSON.stringify(body), "{}");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await loaded.dispose();
  }
});

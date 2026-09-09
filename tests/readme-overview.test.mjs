import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = path.join(repoRoot, "README.md");

test("README is a current-state overview of shipped work with no GitHub identifiers", async () => {
  const readme = await readFile(readmePath, "utf8");
  assert.ok(readme.startsWith("# Grok Bot 0.18"), "README must open as a project overview, not a stub");
  const withoutDocumentedRemotes = readme.replace(
    /https:\/\/github\.com\/(?:Solizardking|b-nnett)\/[A-Za-z0-9._-]+/g,
    "",
  );
  assert.doesNotMatch(
    withoutDocumentedRemotes,
    /github/i,
    "README may name the Solizardking production remotes and archived upstream, but no other GitHub identifiers",
  );

  const featureTerms = [
    "Router",
    "OpenRouter",
    "xAI",
    "Claude Code",
    "Codex",
    "Cursor",
    "PayBox",
    "Telegram",
    "Solana",
    "pump.fun",
    "Kernel",
    "E2B",
    "Browser Use",
    "Docker",
    "Read aloud",
    "web_search",
    "web_fetch",
    "trading skills",
    "bundled_skill_list",
    "bundled_skill_read",
    "Open Wallet Standard",
    "wallets",
    "local-account",
    "Assistant identity",
    "response cache",
    "updater",
    "telemetry",
    "bootstrap",
    "package",
  ];
  for (const term of featureTerms) {
    assert.match(readme, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `README must name shipped capability: ${term}`);
  }

  const productTrees = [
    "source/",
    "frontend/",
    "scripts/",
    "tests/",
    "plugins/",
    "services/",
    "deploy/",
    "docs/",
    "research-archives/",
    "manifests/",
  ];
  for (const tree of productTrees) {
    assert.ok(readme.includes(tree), `README must name product tree ${tree}`);
  }

  const generatedDirs = [".build/", ".cache/", "dist/", "node_modules/", "src/app/dist"];
  for (const dir of generatedDirs) {
    assert.ok(readme.includes(dir), `README must mention generated tree ${dir}`);
  }
  assert.match(
    readme,
    /Generated and ignored working trees[\s\S]{0,400}(?:build outputs|extracted inputs)/i,
    "generated directories must be described as ignored/generated, not authored source",
  );
});

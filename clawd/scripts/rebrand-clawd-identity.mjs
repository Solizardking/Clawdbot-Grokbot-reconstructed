#!/usr/bin/env node
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_NAMES = new Set([
  "LICENSE",
  "NOTICE",
  "NOTICE.md",
  "PROVENANCE.md",
  "README.md",
  "pnpm-lock.yaml",
  "tsconfig.tsbuildinfo.source",
  "rebrand-clawd-identity.mjs",
]);
const SKIP_DIRS = new Set(["node_modules", "dist-ui", "dist-server", "dist-companion", "release", "work", "site", "research-archives"]);
const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".html",
  ".yml",
  ".yaml",
  ".css",
  ".svg",
  ".plist",
  ".swift",
  ".txt",
  ".toml",
  ".sh",
  ".jsonc",
]);

function transform(source, rel) {
  let next = source;
  next = next.replaceAll("OpenMausBot", "Clawd Bot");
  next = next.replaceAll("openmausbot", "clawdbot");
  next = next.replaceAll("OpenMaus", "Clawd");
  next = next.replaceAll("Maus motion", "Clawd motion");
  next = next.replaceAll("compatible Maus", "compatible Clawd");
  next = next.replaceAll("the Maus", "Clawd");
  next = next.replaceAll("a Maus", "a Clawd");
  next = next.replaceAll("any Maus", "any Clawd");
  next = next.replaceAll("SupaMaus", "Clawd");
  next = next.replaceAll("pnpm dev:server", "npm run clawd:server");
  next = next.replaceAll("pnpm --filter", "npm run --prefix");
  if (rel === "src/lib/skins.ts") {
    next = next.replace('export const DEFAULT_SKIN: SkinId = "midnight";', 'export const DEFAULT_SKIN: SkinId = "solana";');
    next = next.replace('const KEY = "omb-skin";', 'const KEY = "clawd-skin";');
    next = next.replace('const KEY = "clawdbot-skin";', 'const KEY = "clawd-skin";');
  }
  return next;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXT.has(ext) && entry.name !== "NOTICE") continue;
    const rel = path.relative(root, full);
    const before = await readFile(full, "utf8");
    const after = transform(before, rel);
    if (after !== before) await writeFile(full, after);
  }
}

await walk(root);
console.log("rebranded", root);

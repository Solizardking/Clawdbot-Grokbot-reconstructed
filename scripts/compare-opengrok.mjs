import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./lib/config.mjs";

// Read-only snapshot: rerun against another checkout and diff the JSON to see
// which reference inputs need review. No provider requests or setup side effects.
const referenceRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, "..", "opengrok-main"));
const referenceAreas = ["assets", "box", "CONTRIBUTING.md", "docs", "examples", "LICENSE", "README.md", "setup.py", "tools", "voice", "wire-captures"];
const targetAreas = ["deploy", "deploy/telegram-bridge", "dist", "docs", "frontend", "manifests", "patches", "research-archives", "scripts", "services", "source", "src", "tests"];
const files = [];
async function inventory(relative) {
  const absolute = path.join(referenceRoot, relative);
  const info = await stat(absolute);
  if (info.isDirectory()) {
    for (const entry of (await readdir(absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", "node_modules", "__pycache__", ".env"].includes(entry.name) || entry.isSymbolicLink()) continue;
      await inventory(`${relative}/${entry.name}`);
    }
  } else if (info.isFile()) {
    const bytes = await readFile(absolute);
    files.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
}
for (const area of referenceAreas) await inventory(area);
for (const area of targetAreas) {
  if (!(await stat(path.join(repoRoot, area))).isDirectory()) throw new Error(`Missing target directory: ${area}`);
}
files.sort((a, b) => a.path.localeCompare(b.path));
console.log(JSON.stringify({ schemaVersion: 1, reference: "opengrok-main", targetAreas, referenceFiles: files }, null, 2));

import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const outputRoot = path.join(repoRoot, ".build", "telegram-bridge");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

// Mirrors the deterministic coordinator adapter: the bundle must invoke its
// own runtime entrypoint, otherwise the container boots and exits instantly.
const serverEntry = `
import { runTelegramBridgeEntrypoint } from "./source/telegram-bridge-server/main.ts";

void runTelegramBridgeEntrypoint().catch((error) => {
  process.stderr.write(\`telegram-bridge: composition failure: \${String(error)}\\n\`);
  process.exit(1);
});
`;

await esbuild({
  absWorkingDir: repoRoot,
  stdin: { contents: serverEntry, resolveDir: repoRoot, sourcefile: "scripts/build-entry/telegram-bridge.ts", loader: "ts" },
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  outfile: path.join(outputRoot, "server.cjs"),
  legalComments: "none",
  logLevel: "warning",
});
await cp(path.join(repoRoot, "deploy/telegram-bridge/Dockerfile"), path.join(outputRoot, "Dockerfile"));
await cp(path.join(repoRoot, "deploy/telegram-bridge/fly.toml"), path.join(outputRoot, "fly.toml"));
await cp(path.join(repoRoot, "deploy/telegram-bridge/.dockerignore"), path.join(outputRoot, ".dockerignore"));
console.log(`telegram-bridge bundle ready: ${path.join(outputRoot, "server.cjs")}`);

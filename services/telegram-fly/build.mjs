import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serviceRoot, "..", "..");
const outfile = path.join(serviceRoot, "dist", "server.mjs");

mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  absWorkingDir: repoRoot,
  entryPoints: [path.join(repoRoot, "source", "services", "telegram-fly", "server.ts")],
  bundle: true,
  format: "esm",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  platform: "node",
  target: "es2022",
  minify: false,
  sourcemap: false,
  outfile,
  logLevel: "info",
});
console.log(`built ${outfile}`);

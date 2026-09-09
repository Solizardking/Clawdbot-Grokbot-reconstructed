import { outputApp, repoRoot } from "./lib/config.mjs";
import { launchPackagedApp } from "./native-e2e-check.mjs";
import { run } from "./lib/process.mjs";
import path from "node:path";

// The default package uses a checksum-pinned renderer plus reviewed extensions.
// Verify its full composition before launch; the clean-renderer E2E command
// retains its stricter clean-source-only contract for diagnostic candidates.
await run(process.execPath, [path.join(repoRoot, "scripts/verify.mjs"), "--app", outputApp]);
const report = await launchPackagedApp({
  appPath: outputApp,
  productionStartup: false,
  timeoutMs: 12_000,
});

for (const item of report.diagnostics) {
  console.log(`${item.status.toUpperCase().padEnd(4)} ${item.check}: ${item.detail}`);
}
console.log(`Smoke verification: ${report.status.toUpperCase()}`);
process.exitCode = report.status === "pass" ? 0 : report.status === "prerequisite" ? 2 : 1;

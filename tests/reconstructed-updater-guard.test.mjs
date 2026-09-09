import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

import {
  applyReconstructedUpdaterGuard,
  prepareReconstructedElectronMainArtifactFallback,
  reconstructedUpdaterGuard,
} from "../scripts/lib/build-asar.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("portable packages skip the update-location dialog only when updates are disabled", async () => {
  const result = await build({ entryPoints: [path.join(root, "source/electron-main/startup/startup-move-check.ts")], bundle: true, write: false, format: "esm", platform: "node" });
  const { runStartupMoveCheck } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  for (const disabled of ["1", "0"]) {
    let dialogs = 0;
    const disposition = await runStartupMoveCheck({ dataRootSettlement: null, isLabBuild: false, hasPendingActivation: () => false, beforeExit() {} }, {
      env: { SAND_DISABLE_UPDATES: disabled }, platform: "darwin",
      app: { isPackaged: true, isInApplicationsFolder: () => false, moveToApplicationsFolder: () => { throw new Error("unexpected move"); }, relaunch() {}, exit() {} },
      dialog: { showMessageBox: async () => { dialogs++; return { response: 1 }; } },
      readDiscovery: async () => null, isDaemonProcess: () => false, terminate: async () => {}, isProcessAlive: () => false,
    });
    assert.equal(disposition, "continue-bootstrap");
    assert.equal(dialogs, disabled === "1" ? 0 : 1);
  }
});

test("reconstructed fallback and clean packaging share one idempotent service guard", async () => {
  const source = "console.log('electron-main');\n";
  const guarded = applyReconstructedUpdaterGuard(source);
  assert.equal(guarded, `${reconstructedUpdaterGuard}${source}`);
  assert.equal(applyReconstructedUpdaterGuard(guarded), guarded);
  assert.match(guarded, /SAND_DISABLE_UPDATES = "1"/);
  assert.doesNotMatch(guarded, /SAND_DISABLE_UPDATES \?\?=/);
  assert.match(guarded, /SAND_DISABLE_SENTRY \?\?= "1"/);
  assert.match(guarded, /SAND_DISABLE_TELEMETRY \?\?= "1"/);

  const fallbackFixture = [
    "var isSandLabBuild2 = appPackageJson.sandLab === true;",
    "var isPrimaryInstance = !import_electron51.app.isPackaged || import_electron51.app.requestSingleInstanceLock();",
  ].join("\n");
  assert.ok(prepareReconstructedElectronMainArtifactFallback(fallbackFixture).startsWith(reconstructedUpdaterGuard));

  const cleanBuildSource = await readFile(path.join(root, "scripts", "clean-build.mjs"), "utf8");
  assert.match(cleanBuildSource, /fidelityRuntimeComposition, \{ reconstructedPackage: true \}/);
});

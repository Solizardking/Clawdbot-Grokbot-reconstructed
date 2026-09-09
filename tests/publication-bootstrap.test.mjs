import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createPackage, createPackageWithOptions } from "@electron/asar";

import { cachedRuntimeApp, upstreamAsarSha256 } from "../scripts/lib/config.mjs";
import { hydrateSourcePayloadFromAsar } from "../scripts/lib/runtime.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("checked-in production bindings resolve only to reviewed source", async () => {
  const manifestPath = path.join(
    repositoryRoot,
    "manifests/reconstruction/electron-main-production-bindings-manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(manifest.bindings.length > 0);
  for (const binding of manifest.bindings) {
    assert.match(binding.module, /^\.\.\/\.\.\/source\//);
    const resolved = path.resolve(path.dirname(manifestPath), binding.module);
    assert.ok(resolved.startsWith(`${path.join(repositoryRoot, "source")}${path.sep}`));
    await access(resolved);
  }
});

test("bootstrap hydration verifies and extracts the minimum upstream runtime payload", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "grok-publication-bootstrap-"));
  try {
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    for (const relative of [
      "dist/electron-main/main.cjs",
      "dist/host/host-main.cjs",
      "dist/renderer/index.html",
    ]) {
      const target = path.join(source, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `fixture:${relative}\n`);
    }
    await writeFile(path.join(source, "package.json"), "{\"name\":\"fixture\"}\n");
    const archive = path.join(root, "app.asar");
    await createPackage(source, archive);
    const archiveBytes = await readFile(archive);
    const expectedSha256 = createHash("sha256").update(archiveBytes).digest("hex");

    const result = await hydrateSourcePayloadFromAsar(archive, { destination, expectedSha256 });
    assert.equal(result.sha256, expectedSha256);
    assert.equal(
      await readFile(path.join(destination, "dist/renderer/index.html"), "utf8"),
      "fixture:dist/renderer/index.html\n",
    );

    await assert.rejects(
      hydrateSourcePayloadFromAsar(archive, { destination, expectedSha256: "0".repeat(64) }),
      /checksum mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrap hydration skips dangling unpacked npm bin stubs listed in the asar", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "grok-publication-unpacked-"));
  try {
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    for (const relative of [
      "dist/electron-main/main.cjs",
      "dist/host/host-main.cjs",
      "dist/renderer/index.html",
    ]) {
      const target = path.join(source, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `fixture:${relative}\n`);
    }
    const stub = path.join(source, "dist/deps/better-sqlite3/node_modules/.bin/prebuild-install");
    await mkdir(path.dirname(stub), { recursive: true });
    await writeFile(stub, "#!/bin/sh\necho stub\n");
    const archive = path.join(root, "app.asar");
    await createPackageWithOptions(source, archive, { unpack: "prebuild-install" });
    const unpackedStub = path.join(`${archive}.unpacked`, "dist/deps/better-sqlite3/node_modules/.bin/prebuild-install");
    await access(unpackedStub);
    await rm(unpackedStub);

    const archiveBytes = await readFile(archive);
    const expectedSha256 = createHash("sha256").update(archiveBytes).digest("hex");
    const result = await hydrateSourcePayloadFromAsar(archive, { destination, expectedSha256 });
    assert.equal(result.sha256, expectedSha256);
    assert.equal(
      await readFile(path.join(destination, "dist/renderer/index.html"), "utf8"),
      "fixture:dist/renderer/index.html\n",
    );
    assert.equal(
      await readFile(path.join(destination, "dist/electron-main/main.cjs"), "utf8"),
      "fixture:dist/electron-main/main.cjs\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cached 0.18 runtime asar hydrates despite dangling unpacked bins", async (t) => {
  const archive = path.join(cachedRuntimeApp, "Contents", "Resources", "app.asar");
  try {
    await access(archive);
  } catch {
    t.skip("cached 0.18 runtime is a local bootstrap input, not a published source file");
    return;
  }
  const destination = await mkdtemp(path.join(tmpdir(), "grok-hydrate-runtime-"));
  try {
    const result = await hydrateSourcePayloadFromAsar(archive, {
      destination,
      expectedSha256: upstreamAsarSha256,
    });
    assert.equal(result.sha256, upstreamAsarSha256);
    for (const relative of [
      "dist/electron-main/main.cjs",
      "dist/host/host-main.cjs",
      "dist/renderer/index.html",
    ]) {
      await access(path.join(destination, relative));
    }
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

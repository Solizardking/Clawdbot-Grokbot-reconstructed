import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadOws() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ows-wallets-"));
  const output = path.join(temporary, "ows-service.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/wallets/ows-service.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    external: ["@open-wallet-standard/core"],
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function sampleWallet(name = "treasury") {
  return {
    id: "wal_1",
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    accounts: [{ chainId: "solana:mainnet", address: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY", derivationPath: "m/44'/501'/0'" }],
    mnemonic: "abandon abandon abandon",
    privateKey: "secret-key-material",
  };
}

test("bot tools request a wallet without a password and only return public fields", async () => {
  const loaded = await loadOws();
  try {
    const calls = [];
    const service = loaded.module.createOwsService({
      run: async (operation, args) => {
        calls.push({ operation, args: { ...args, password: args.password } });
        if (operation === "list") return [sampleWallet("saved")];
        return sampleWallet(args.name);
      },
    });
    const requested = loaded.module.executeOwsTool(service, "ows_wallet_create", { name: "treasury" });
    assert.equal(requested.status, "awaiting_password");
    assert.equal(requested.name, "treasury");
    assert.ok(String(requested.instruction).includes("masked"));
    assert.equal(requested.password, undefined);
    assert.equal(calls.length, 0, "create must not run until the desktop form supplies a password");

    const listed = await loaded.module.executeOwsTool(service, "ows_wallet_list", {});
    assert.equal(listed.wallets.length, 1);
    assert.equal(listed.wallets[0].name, "saved");
    assert.equal(listed.wallets[0].accounts[0].address, "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY");
    assert.equal(listed.wallets[0].mnemonic, undefined);
    assert.equal(listed.wallets[0].privateKey, undefined);
    assert.equal(listed.wallets[0].accounts[0].derivationPath, undefined);

    const created = await service.createOwsWallet({ name: "treasury", password: "correct horse", requestId: requested.id });
    assert.equal(created.name, "treasury");
    assert.equal(created.mnemonic, undefined);
    assert.equal(created.privateKey, undefined);
    assert.equal(calls.at(-1).operation, "create");
    assert.equal(calls.at(-1).args.password, "correct horse");

    const pending = loaded.module.executeOwsTool(service, "ows_wallet_requests", {});
    assert.equal(pending.requests[0].status, "created");
    assert.equal(pending.requests[0].wallet.privateKey, undefined);
    assert.equal(JSON.stringify(pending).includes("correct horse"), false);
    assert.equal(JSON.stringify(pending).includes("secret-key-material"), false);
  } finally { await loaded.dispose(); }
});

test("Trading panel masked password submits through preload sand:ows-create to createOwsWallet", async () => {
  const { readFile } = await import("node:fs/promises");
  const patch = await readFile(path.join(repoRoot, "scripts/lib/solana-mode-patch.mjs"), "utf8");
  const preload = await readFile(path.join(repoRoot, "source/electron-preload/preload.ts"), "utf8");
  const ipc = await readFile(path.join(repoRoot, "source/electron-main/adapters/ipc.ts"), "utf8");
  assert.match(patch, /type: "password"/);
  assert.match(patch, /aria-label": "OWS wallet password"/);
  assert.match(patch, /api\.createWallet\(\{ name: name, password: password/);
  assert.match(preload, /createWallet: \(request: \{name: string; password: string; requestId\?: string\}\) => ipc\.invoke\("sand:ows-create", request\)/);
  assert.match(ipc, /ipc\.handle\("sand:ows-create".*createOwsWallet/);
});

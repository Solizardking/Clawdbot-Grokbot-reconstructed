import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import bs58 from "bs58";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RFC8032_SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const RFC8032_PUB = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");

async function loadCore() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wallet-core-"));
  const output = path.join(temporary, "solana-wallet-core.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/shared/solana-wallet-core.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("wallet-core Address accepts only 32-byte Base58 payloads", async () => {
  const loaded = await loadCore();
  try {
    const address = loaded.module.encodeSolanaAddress(RFC8032_PUB);
    assert.equal(loaded.module.isValidSolanaAddress(address), true);
    assert.equal(loaded.module.isValidSolanaAddress("86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY"), true);
    assert.equal(loaded.module.isValidSolanaAddress("z".repeat(32)), false);
    assert.equal(loaded.module.isValidSolanaAddress("zzz"), false);
    assert.equal(loaded.module.isValidSolanaAddress("not an address"), false);
  } finally { await loaded.dispose(); }
});

test("wallet-core Entry decodePrivateKey accepts seed, seed||pub, and hex", async () => {
  const loaded = await loadCore();
  try {
    const fromSeed = loaded.module.decodeSolanaPrivateKey(bs58.encode(RFC8032_SEED));
    assert.equal(fromSeed.address, loaded.module.encodeSolanaAddress(RFC8032_PUB));
    const secret64 = bs58.encode(Buffer.concat([RFC8032_SEED, RFC8032_PUB]));
    const fromSecret = loaded.module.decodeSolanaPrivateKey(secret64);
    assert.ok(fromSecret.seed.equals(RFC8032_SEED));
    const fromHex = loaded.module.decodeSolanaPrivateKey(RFC8032_SEED.toString("hex"));
    assert.equal(fromHex.address, fromSeed.address);
    const mangled = Buffer.concat([RFC8032_SEED, Buffer.alloc(32, 1)]);
    assert.throws(() => loaded.module.decodeSolanaPrivateKey(bs58.encode(mangled)), /Invalid private key/);
  } finally { await loaded.dispose(); }
});

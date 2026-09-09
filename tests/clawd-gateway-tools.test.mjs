import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";

async function loadModule(entry) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "grok-clawd-gateway-"));
  const output = path.join(temporary, `${path.basename(entry, ".ts")}.mjs`);
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("clawd gateway tools stay hidden without CLAWD_GATEWAY_URL and call the real routes with the Helius header", async () => {
  const loaded = await loadModule("source/node-agent-coordinator/clawd-gateway-tools.ts");
  try {
    assert.deepEqual(loaded.module.clawdGatewayRoutedTools({}), []);
    const tools = loaded.module.clawdGatewayRoutedTools({ CLAWD_GATEWAY_URL: "http://127.0.0.1:15888" });
    assert.deepEqual(tools.map(tool => tool.name), ["clawd_gateway_status", "clawd_gateway_solana_balances", "clawd_gateway_quote"]);
    const calls = [];
    const port = {
      fetchImpl: async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body == null ? null : JSON.parse(init.body) });
        return { ok: true, status: 200, json: async () => ({ chain: "solana", rpcUrl: "https://gateway-internal" }) };
      },
      gatewayUrl: async () => "http://127.0.0.1:15888",
      gatewayToken: async () => "gw-token",
      heliusRpcUrl: async () => "https://mainnet.helius-rpc.com/?api-key=test",
    };
    const status = await loaded.module.executeClawdGatewayRoutedTool(port, "clawd_gateway_status", {});
    assert.equal(status.heliusRpcUrl, "https://mainnet.helius-rpc.com/?api-key=test");
    assert.equal(calls[0].url, "http://127.0.0.1:15888/chains/solana/status?network=mainnet-beta");
    assert.equal(calls[0].headers.authorization, "Bearer gw-token");
    assert.equal(calls[0].headers["x-helius-rpc-url"], "https://mainnet.helius-rpc.com/?api-key=test");
    await loaded.module.executeClawdGatewayRoutedTool(port, "clawd_gateway_solana_balances", { address: OWNER, tokens: ["SOL"] });
    assert.equal(calls[1].url, "http://127.0.0.1:15888/chains/solana/balances");
    assert.equal(calls[1].body.address, OWNER);
    await loaded.module.executeClawdGatewayRoutedTool(port, "clawd_gateway_quote", { amount: 1.5, base_token: "SOL", quote_token: "USDC" });
    assert.equal(calls[2].url, "http://127.0.0.1:15888/trading/swap/quote");
    assert.equal(calls[2].body.connector, "jupiter/router");
    await assert.rejects(loaded.module.executeClawdGatewayRoutedTool(port, "clawd_gateway_solana_balances", { address: "nope" }), /valid base58/);
  } finally { await loaded.dispose(); }
});

test("production and coordinator wire Clawd Gateway tools", async () => {
  const router = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(router, /from "\.\/clawd-gateway-tools\.js"/);
  assert.match(router, /isClawdGatewayRoutedTool\(name\)\) return executeClawdGatewayRoutedTool/);
  const services = await readFile(path.join(repoRoot, "source/electron-main/main-production-services.ts"), "utf8");
  assert.match(services, /CLAWD_GATEWAY_ROUTED_TOOLS/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controlPlaneRoot = path.join(repoRoot, "clawd/cloudflare/control-plane");
const brokerRoot = path.join(repoRoot, "clawd/cloudflare/composio-broker");

async function read(relative) {
  return readFile(path.join(repoRoot, relative), "utf8");
}

function parseJsonc(text) {
  const stripped = text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

test("shipped control-plane Worker is Better Auth 1.7.1 with email OTP, bearer, and healthz", async () => {
  const pkg = JSON.parse(await read("clawd/cloudflare/control-plane/package.json"));
  assert.equal(pkg.dependencies["better-auth"], "1.7.1");

  const auth = await read("clawd/cloudflare/control-plane/src/auth.ts");
  assert.match(auth, /from "better-auth"/);
  assert.match(auth, /emailOTP/);
  assert.match(auth, /bearer\(\s*\{\s*requireSignature:\s*true\s*\}\)/);
  assert.match(auth, /storeOTP:\s*"hashed"/);
  assert.match(auth, /startsWith\("omb_install_"\)/);
  assert.match(auth, /export async function accountSession/);

  const worker = await read("clawd/cloudflare/control-plane/src/index.ts");
  assert.match(worker, /pathname === "\/healthz"/);
  assert.match(worker, /ok:\s*true,\s*service:\s*"clawdbot-control-plane"/);
  assert.match(worker, /pathname\.startsWith\("\/api\/auth\/"\)/);
  assert.match(worker, /createAuth\(/);
  assert.match(worker, /accountSession\(/);

  const wrangler = parseJsonc(await read("clawd/cloudflare/control-plane/wrangler.jsonc"));
  assert.equal(wrangler.name, "clawdbot-control-plane");
  assert.match(String(wrangler.vars.BETTER_AUTH_URL), /^https:\/\//);
  assert.deepEqual(wrangler.secrets.required, ["BETTER_AUTH_SECRET", "CLOUDFLARE_API_TOKEN"]);
  assert.equal(typeof wrangler.workers_dev, "boolean");
});

test("shipped Composio broker Worker exposes clawdbot-composio health identity", async () => {
  const worker = await read("clawd/cloudflare/composio-broker/src/index.ts");
  assert.match(worker, /pathname === "\/health"/);
  assert.match(
    worker,
    /json\(\{\s*service:\s*"clawdbot-composio",\s*ready:\s*Boolean\(env\.COMPOSIO_API_KEY\)\s*\}\)/,
  );

  const wrangler = parseJsonc(await read("clawd/cloudflare/composio-broker/wrangler.jsonc"));
  assert.equal(wrangler.name, "clawdbot-composio");
  assert.deepEqual(wrangler.secrets.required, ["COMPOSIO_API_KEY"]);
  assert.equal(wrangler.vars.COMPOSIO_API_KEY, undefined);
});

test("root npm scripts drive the Worker trees without a leftover pnpm workspace", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["control-plane:check"], "npm run check --prefix clawd/cloudflare/control-plane");
  assert.equal(pkg.scripts["control-plane:test"], "npm test --prefix clawd/cloudflare/control-plane");
  assert.equal(pkg.scripts["control-plane:dry-run"], "npm run dry-run --prefix clawd/cloudflare/control-plane");
  assert.equal(pkg.scripts["control-plane:deploy"], "npm run deploy --prefix clawd/cloudflare/control-plane");
  assert.equal(pkg.scripts["composio-broker:test"], "npm test --prefix clawd/cloudflare/composio-broker");
  assert.equal(pkg.scripts["composio-broker:dry-run"], "npm run dry-run --prefix clawd/cloudflare/composio-broker");
  assert.equal(pkg.scripts["composio-broker:deploy"], "npm run deploy --prefix clawd/cloudflare/composio-broker");
  assert.ok(controlPlaneRoot.endsWith("clawd/cloudflare/control-plane"));
  assert.ok(brokerRoot.endsWith("clawd/cloudflare/composio-broker"));
});

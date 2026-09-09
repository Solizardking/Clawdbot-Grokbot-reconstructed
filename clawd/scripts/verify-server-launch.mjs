import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logPath = process.argv[2];
const port = Number(process.argv[3] || 18799);
const dataDir = await mkdtemp(path.join(os.tmpdir(), "clawd-harness-"));
const logs = [];
const say = (line) => {
  logs.push(line);
  console.log(line);
};

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", path.join(repoRoot, "server/harness-entry.ts")],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAWD_PORT: String(port),
      CLAWD_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});

function textHasContent(value) {
  return value.length > 20 && value !== "{}";
}

const started = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server start timeout")), 15000);
  const onOut = (chunk) => {
    if (String(chunk).includes("harness on http://")) {
      clearTimeout(timer);
      resolve(true);
    }
  };
  child.stdout.on("data", onOut);
  child.on("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`server exited ${code}: ${stderr}`));
  });
});
say(`started=${started}`);
say(`stdout=${stdout.trim()}`);

const body = await new Promise((resolve, reject) => {
  http
    .get(`http://127.0.0.1:${port}/api/health`, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        say(`status=${res.statusCode}`);
        say(`body=${text}`);
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    })
    .on("error", reject);
});

if (body.name !== "Clawd Bot") throw new Error(`name=${body.name}`);
if (body.app !== "clawdbot") throw new Error(`app=${body.app}`);
if (typeof body.pid !== "number") throw new Error("pid missing");
if (!body.solana || typeof body.solana.phantomConfigured !== "boolean") {
  throw new Error("solana status missing");
}
if (!Array.isArray(body.connectors) || body.connectors.length !== 6) {
  throw new Error("connectors missing");
}
if (!textHasContent(JSON.stringify(body))) throw new Error("empty body");

const created = await new Promise((resolve, reject) => {
  const req = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/solana/wallets/local",
      method: "POST",
      headers: { "content-type": "application/json" },
    },
    (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        say(`wallet-status=${res.statusCode}`);
        say(`wallet-body=${text}`);
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    },
  );
  req.on("error", reject);
  req.end(JSON.stringify({ name: "intro" }));
});
if (!created?.address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(created.address)) {
  throw new Error(`wallet create failed: ${JSON.stringify(created)}`);
}
say("OK");

child.kill("SIGTERM");
await new Promise((resolve) => child.on("exit", resolve));
fs.writeFileSync(logPath, `${logs.join("\n")}\n${stderr}`);

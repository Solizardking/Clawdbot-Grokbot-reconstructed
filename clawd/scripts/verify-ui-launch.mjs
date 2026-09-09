import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(repoRoot, "dist-ui");
const shot = process.argv[2];
const logPath = process.argv[3];
const logs = [];
const say = (line) => {
  logs.push(line);
  console.log(line);
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

const dataDir = await mkdtemp(path.join(os.tmpdir(), "clawd-ui-harness-"));
const harnessPort = 19000 + Math.floor(Math.random() * 1000);
const harness = spawn(
  process.execPath,
  ["--experimental-strip-types", path.join(repoRoot, "server/harness-entry.ts")],
  {
    cwd: repoRoot,
    env: { ...process.env, CLAWD_PORT: String(harnessPort), CLAWD_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("harness start timeout")), 15000);
  harness.stdout.on("data", (chunk) => {
    if (String(chunk).includes("harness on http://")) {
      clearTimeout(timer);
      resolve();
    }
  });
  harness.stderr.on("data", (chunk) => process.stderr.write(chunk));
  harness.on("exit", (code) => reject(new Error(`harness exited ${code}`)));
});
say(`harness=http://127.0.0.1:${harnessPort}`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/api/")) {
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: harnessPort,
        path: url.pathname + url.search,
        method: req.method,
        headers: req.headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("error", () => {
      res.writeHead(502);
      res.end("harness proxy failed");
    });
    req.pipe(proxy);
    return;
  }
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(dist, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}/`;
say(`serving ${dist} at ${origin}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  // UI-only launch has no harness; the SSE client 404s on /api/events.
  if (text.includes("Failed to load resource") && text.includes("404")) return;
  pageErrors.push(`console.error ${text}`);
});

await page.goto(origin, { waitUntil: "networkidle" });
await page.waitForSelector("#root");
const title = await page.title();
const skin = await page.locator("html").getAttribute("data-skin");
const tokens = await page.evaluate(() => {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: style.getPropertyValue("--color-accent").trim(),
    border: style.getPropertyValue("--color-accent-border").trim(),
    focus: style.getPropertyValue("--color-focus").trim(),
    hasWindow: typeof window !== "undefined",
    hasRequire: typeof window.require,
    hasModule: typeof window.module,
    rootText: document.getElementById("root")?.innerText?.slice(0, 500) ?? "",
    rootChildCount: document.getElementById("root")?.children.length ?? 0,
    filled: (document.getElementById("root")?.innerText?.length ?? 0) > 40,
  };
});
say(`title=${title}`);
say(`skin=${skin}`);
say(`tokens=${JSON.stringify(tokens)}`);
say(`pageErrors=${JSON.stringify(pageErrors)}`);

const rootText = tokens.rootText;
for (const name of ["Jupiter", "Phantom", "Pump.fun", "Helius", "PayBox", "lobster"]) {
  if (!rootText.includes(name)) throw new Error(`missing connector ${name}`);
}
if (!rootText.includes("Pump.fun tape") && !rootText.includes("Listening for launches")) {
  throw new Error("tape region missing");
}
if (rootText.includes("Meet Clawd Bot") || rootText.includes("Give each Bot a job")) {
  throw new Error("old intro still showing");
}
if (!rootText.includes("Clawd Bot on Solana")) throw new Error("new intro heading missing");
const nameInput = page.getByPlaceholder("Wallet name");
await nameInput.fill("Cluster Operator");
const typed = await nameInput.inputValue();
say(`typed=${typed}`);
await page.getByRole("button", { name: "Create wallet" }).click();
await page.waitForSelector("[data-wallet-address], [data-wallet-error]", { timeout: 8000 });
const afterClick = await page.locator("[data-wallet-address], [data-wallet-error]").first().textContent();
say(`walletFeedback=${afterClick}`);
if (!afterClick || afterClick.trim().length === 0) throw new Error("wallet create produced no visible result");

if (title !== "Clawd Bot") throw new Error(`title was ${title}`);
if (skin !== "solana") throw new Error(`skin was ${skin}`);
if (!/#14F195/i.test(tokens.accent) && !/rgb\(20,\s*241,\s*149\)/i.test(tokens.accent)) {
  throw new Error(`accent token not Solana green: ${tokens.accent}`);
}
if (!/#9945FF/i.test(tokens.border) && !/rgb\(153,\s*69,\s*255\)/i.test(tokens.border)) {
  throw new Error(`border token not Solana purple: ${tokens.border}`);
}
if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
if (!tokens.hasWindow) throw new Error("window missing");
if (tokens.hasRequire !== "undefined") throw new Error("Node require leaked");
if (!tokens.filled) throw new Error("root was empty");
if (typed !== "Cluster Operator") throw new Error("input did not take a value");

await page.screenshot({ path: shot, fullPage: true });
say(`screenshot=${shot}`);
say("OK");

await browser.close();
server.close();
harness.kill("SIGTERM");
fs.writeFileSync(logPath, logs.join("\n") + "\n");

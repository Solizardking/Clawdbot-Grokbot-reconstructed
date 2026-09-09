"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

function loadBoxEnv() {
  // Shell values win, followed by box/.env and then clawd/.env.
  for (const file of [path.join(__dirname, ".env"), path.join(__dirname, "../.env")]) {
    if (!fs.existsSync(file)) continue;
    const values = parseEnv(fs.readFileSync(file, "utf8"));
    for (const name of ["UPSTASH_BOX_API_KEY", "UPSTASH_BOX_MODEL", "UPSTASH_BOX_NAME"]) {
      if (!process.env[name] && values[name]) process.env[name] = values[name];
    }
  }
  if (!process.env.UPSTASH_BOX_API_KEY?.trim()) {
    throw new Error("Set UPSTASH_BOX_API_KEY in clawd/box/.env or your shell before running this script.");
  }
}

async function main() {
  loadBoxEnv();
  const boxName = process.env.UPSTASH_BOX_NAME || "polite-bulldog-70639";
  if (process.argv.includes("--connect")) {
    const { spawn } = require("node:child_process");
    const child = spawn("box", ["connect", boxName], { stdio: "inherit", env: process.env });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Box CLI exited (${signal || code}).`));
      });
    });
    return;
  }
  const { Box } = await import("@upstash/box");
  const { z } = require("zod/v3");
  if (process.argv.includes("--check-auth")) {
    await Box.get(boxName, { apiKey: process.env.UPSTASH_BOX_API_KEY });
    console.log(`Upstash Box authentication succeeded: ${boxName}.`);
    return;
  }
  const schema = z.object({ cities: z.array(z.string()).length(5) });
  const box = await Box.get(boxName, {
    apiKey: process.env.UPSTASH_BOX_API_KEY,
  });
  if (process.argv.includes("--code")) {
    const run = await box.exec.code({
      lang: "js",
      code: "const x = Math.floor(Math.random() * 100); console.log('Random number:', x);",
      timeout: 60_000,
    });
    if (run.status !== "completed") throw new Error(`Box code run did not complete (status: ${run.status}).`);
    console.log(run.result);
  } else {
    const run = await box.agent.run({
      prompt: "Give me 5 random city names",
      responseSchema: schema,
      timeout: 120_000,
    });
    if (run.status !== "completed") throw new Error(`Box run did not complete (status: ${run.status}).`);
    console.log(JSON.stringify(schema.parse(run.result), null, 2));
  }
}

function reportError(error) {
  const message = String(error?.message || error);
  const key = process.env.UPSTASH_BOX_API_KEY;
  console.error(key ? message.split(key).join("[REDACTED]") : message);
  process.exitCode = 1;
}

module.exports = { main, reportError, loadBoxEnv };
if (require.main === module) main().catch(reportError);

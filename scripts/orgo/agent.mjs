#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { computers, loadEnv, ensureComputer, readState, runHostedAgent } from "./orgo-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "out");

const HELP = `Orgo computer-use agent (hosted loop)

Usage:
  node scripts/orgo/agent.mjs run "Open Chrome and search for AI news"
  node scripts/orgo/agent.mjs status
  node scripts/orgo/agent.mjs screenshot [out.png]
  node scripts/orgo/agent.mjs bash "ls -la"
  node scripts/orgo/agent.mjs start|stop|restart|delete
  node scripts/orgo/agent.mjs vnc

Setup:
  export ORGO_API_KEY=sk_live_...   (or put it in scripts/orgo/.env)
  Optional: ORGO_COMPUTER_ID, ORGO_MODEL (default claude-sonnet-5)
`;

async function resolveComputerId() {
  if (process.env.ORGO_COMPUTER_ID) return process.env.ORGO_COMPUTER_ID;
  return ensureComputer();
}

async function main() {
  loadEnv();
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    console.log(HELP);
    return;
  }

  const state = readState();
  switch (command) {
    case "run": {
      const instruction = args.join(" ");
      if (!instruction) throw new Error('usage: agent.mjs run "instruction"');
      const computerId = await resolveComputerId();
      console.error(`[orgo] computer ${computerId} — running agent...`);
      const result = await runHostedAgent({
        instruction,
        computerId,
        model: process.env.ORGO_MODEL,
        onDelta: (delta) => process.stdout.write(delta),
      });
      process.stdout.write("\n");
      console.error("[orgo] done");
      if (result) return result;
      return;
    }
    case "status": {
      const computerId = state.computerId ?? process.env.ORGO_COMPUTER_ID;
      if (!computerId) {
        console.log("no computer yet (run `run` to create one)");
        return;
      }
      console.log(JSON.stringify(await computers.get(computerId), null, 2));
      return;
    }
    case "screenshot": {
      const computerId = await resolveComputerId();
      const out = args[0] || join(OUT_DIR, `screenshot-${Date.now()}.png`);
      await computers.screenshot(computerId, out);
      console.log(out);
      return;
    }
    case "bash": {
      const computerId = await resolveComputerId();
      console.log(JSON.stringify(await computers.bash(computerId, args.join(" ")), null, 2));
      return;
    }
    case "start":
    case "stop":
    case "restart": {
      const computerId = await resolveComputerId();
      console.log(JSON.stringify(await computers[command](computerId), null, 2));
      return;
    }
    case "delete": {
      const computerId = state.computerId ?? process.env.ORGO_COMPUTER_ID;
      if (!computerId) throw new Error("no computer to delete");
      console.log(JSON.stringify(await computers.delete(computerId), null, 2));
      return;
    }
    case "vnc": {
      const computer = await computers.get(await resolveComputerId());
      const { password } = await computers.vncPassword(computer.id);
      const instanceId = computer.instance_id ?? state.instanceId;
      console.log(`wss://www.orgo.ai/desktops/${instanceId}/ws/websockify?token=${encodeURIComponent(password)}`);
      return;
    }
    default:
      throw new Error(`unknown command: ${command}\n${HELP}`);
  }
}

main().catch((error) => {
  console.error(`[orgo] ${error.message}`);
  process.exitCode = 1;
});

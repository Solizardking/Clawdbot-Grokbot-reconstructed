#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: clawd-bot [--env-file PATH] [--port PORT]\nStarts Clawd Bot on http://127.0.0.1:8799. Data is stored in ~/.clawdbot.');
  process.exit(0);
}
for (let i = 0; i < args.length; i++) {
  const option = args[i];
  const value = args[++i];
  if (!value || !['--env-file', '--port'].includes(option)) throw new Error('Use --help for supported options.');
  if (option === '--env-file') loadEnvFile(value);
  else {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('Port must be between 1 and 65535.');
    process.env.OMB_PORT = value;
  }
}
const server = new URL('../dist-server/index.js', import.meta.url);
if (!existsSync(server)) throw new Error('Built server missing. Run npm run build from the source checkout.');
process.env.OMB_STATIC_DIR ??= fileURLToPath(new URL('../dist-ui/', import.meta.url));
await import(server.href);

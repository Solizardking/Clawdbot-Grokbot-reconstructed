import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const [origin, clientFile] = process.argv.slice(2);
const token = /^SAND_HOSTED_GATEWAY_TOKEN=([A-Za-z0-9_-]{32,128})$/m.exec(await readFile(clientFile, 'utf8'))?.[1];
if (!token) throw new Error('Client file lacks gateway token');
const temporary = await mkdtemp(join(tmpdir(), 'hosted-solana-smoke-'));
try {
  const output = join(temporary, 'service.cjs');
  await build({ entryPoints: ['source/electron-main/solana/solana-service.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { createSolanaService } = createRequire(import.meta.url)(output);
  const service = createSolanaService({
    revealSecret: async key => key === 'SAND_HOSTED_GATEWAY_URL' ? origin : key === 'SAND_HOSTED_GATEWAY_TOKEN' ? token : null,
    readRegistry: async () => ({ wallets: [] }),
    writeRegistry: async () => { throw new Error('Read-only smoke must not write wallets'); },
    loadServerSdk: async () => { throw new Error('Read-only smoke must not use Phantom'); },
    fetchImpl: async (url, init) => {
      if (![`${origin}/v1/account`, `${origin}/helius/rpc`].includes(url) || init.headers.authorization !== `Bearer ${token}`) throw new Error('Unexpected direct provider request');
      return fetch(url, init);
    },
  });
  if (!(await service.getStatus()).heliusConfigured) throw new Error('Hosted Helius not ready');
  await service.getWalletAssets({ ownerAddress: '11111111111111111111111111111111', limit: 1 });
  console.log('PASS: desktop Solana readiness and wallet-assets request through Fly using only the user token.');
} finally { await rm(temporary, { recursive: true, force: true }); }

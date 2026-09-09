import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('desktop secret synchronization never exports PayBox credentials to the box', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'paybox-boundary-'));
  try {
    const outfile = path.join(dir, 'secrets.mjs');
    await build({ entryPoints: ['source/electron-main/secrets/secrets-ipc.ts'], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent', external: ['electron'] });
    const { createBoxSecretsPush } = await import(pathToFileURL(outfile));
    const sent = [], reports = [];
    const original = { OPENROUTER_API_KEY: 'test-openrouter', PAYBOX_SIGNING_KEY: 'test-signing', PAYBOX_API_KEY: 'test-paybox', PAYBOX_ACCESS_TOKEN: 'test-token' };
    const push = createBoxSecretsPush({
      userSecretsStore: { exportSnapshot: async () => ({ secrets: original, accountScope: 'test' }) },
      isAccountDeparting: () => false,
      setBoxSecrets: async request => { sent.push(request); return { isApplied: true }; },
      report: report => reports.push(report),
    });
    assert.equal(await push.push('test'), true);
    assert.deepEqual(sent, [{ secrets: { OPENROUTER_API_KEY: 'test-openrouter' } }]);
    assert.equal(reports[0].secretCount, 1);
    assert.equal(original.PAYBOX_SIGNING_KEY, 'test-signing');
    for (const status of [{ isApplied: false }, {}]) {
      const pending = createBoxSecretsPush({
        userSecretsStore: { exportSnapshot: async () => ({ secrets: {}, accountScope: 'test' }) },
        isAccountDeparting: () => false,
        setBoxSecrets: async () => status,
        report: () => {},
      });
      assert.equal(await pending.push('test'), false, 'accepted but unapplied secrets must not be reported as synchronized');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

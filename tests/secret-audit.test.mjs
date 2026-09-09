import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBytes, isPrivatePath } from '../scripts/lib/secret-audit.mjs';

test('secret path rules cover nested env, backups, and keys while permitting templates', () => {
  for (const file of ['.env.local', 'deploy/openrouter.env', 'nested/config.env.backup', 'nested/.dev.vars.production', 'wallet.json', 'wallet-keypair.json', 'private.pem']) assert.equal(isPrivatePath(file), true, file);
  for (const file of ['.env.example', 'deploy/openrouter.env.example', 'nested/.dev.vars.example', 'source/env-file.ts']) assert.equal(isPrivatePath(file), false, file);
});
test('secret checks report labels only and detect staged credential bytes', () => {
  const secret = 'sensitive-' + 'value'.repeat(8);
  const results = inspectBytes(Buffer.from(`prefix ${secret} suffix`), [{value:Buffer.from(secret), key:'TEST_API_KEY'}]);
  assert.deepEqual(results, ['local credential (TEST_API_KEY)']);
  assert.equal(JSON.stringify(results).includes(secret), false);
  assert.deepEqual(inspectBytes(Buffer.from('safe content')), []);
  assert.ok(inspectBytes(Buffer.from('sk-' + 'aB12'.repeat(10))).includes('provider credential'));
});

test('repository check catches a staged secret after the worktree is cleaned, without echoing it', async () => {
  const { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'secret-audit-test-'));
  try {
    mkdirSync(join(dir, 'scripts/lib'), {recursive:true});
    cpSync(new URL('../scripts/check-secrets.mjs', import.meta.url), join(dir, 'scripts/check-secrets.mjs'));
    cpSync(new URL('../scripts/lib/secret-audit.mjs', import.meta.url), join(dir, 'scripts/lib/secret-audit.mjs'));
    execFileSync('git', ['init', '-q', dir]);
    writeFileSync(join(dir, '.gitignore'), '.env.local\n');
    const secret = 'fixture-staged-' + 'credential'.repeat(4);
    writeFileSync(join(dir, '.env.local'), `CUSTOM_API_KEY=${secret}\n`);
    writeFileSync(join(dir, 'config.txt'), secret);
    execFileSync('git', ['add', '.'], {cwd:dir});
    writeFileSync(join(dir, 'config.txt'), 'clean worktree');
    let result = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], {cwd:dir, encoding:'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /config.txt \[index\]: local credential/);
    assert.equal((result.stdout + result.stderr).includes(secret), false);
    execFileSync('git', ['add', 'config.txt'], {cwd:dir});
    result = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], {cwd:dir, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(dir, 'accidental-copy.txt'), secret);
    result = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], {cwd:dir, encoding:'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /accidental-copy.txt \[untracked\]/);
    assert.equal((result.stdout + result.stderr).includes(secret), false);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

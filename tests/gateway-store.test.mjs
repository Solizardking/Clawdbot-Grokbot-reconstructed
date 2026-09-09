import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGatewayStore } from '../services/provider-gateway/store.mjs';

test('daily reservations survive restart, share limits between connections, and isolate users and days', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gateway-store-'));
  const path = join(directory, 'state.sqlite');
  const today = Date.parse('2026-09-07T12:00:00Z');
  let first, second;
  try {
    first = createGatewayStore(path);
    second = createGatewayStore(path);
    first.claim('alice', 'browseruse', [{ kind: 'run', id: 'run-a' }, { kind: 'session', id: 'session-a' }]);
    assert.equal(second.owns('alice', 'browseruse', 'run', 'run-a'), true);
    assert.equal(second.owns('bob', 'browseruse', 'run', 'run-a'), false);
    assert.throws(() => second.claim('bob', 'browseruse', [{ kind: 'run', id: 'run-b' }, { kind: 'session', id: 'session-a' }]));
    assert.equal(first.owns('bob', 'browseruse', 'run', 'run-b'), false);
    assert.equal(first.reserve('alice', today, 2), true);
    assert.equal(second.reserve('alice', today, 2), true);
    assert.equal(first.reserve('alice', today, 2), false);
    assert.equal(second.reserve('bob', today, 2), true);
    first.close(); first = createGatewayStore(path);
    assert.equal(first.owns('alice', 'browseruse', 'session', 'session-a'), true);
    assert.equal(first.reserve('alice', today, 2), false);
    assert.equal(first.usage('alice', today).requests, 2);
    assert.equal(first.usage('bob', today).requests, 1);
    assert.equal(first.reserve('alice', today + 86400000, 2), true);
    assert.equal(first.usage('alice', today + 86400000).requests, 1);
    assert.equal(first.usage('charlie', today).requests, 0);
  } finally {
    first?.close(); second?.close();
    await rm(directory, { force: true, recursive: true });
  }
});

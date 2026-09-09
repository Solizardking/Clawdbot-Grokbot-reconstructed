import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseHostedAccessFile } from './lib/hosted-access-file.mjs';

const access = parseHostedAccessFile(await readFile('.cache/gateway-owner/client.env', 'utf8'));
const contextId = `desktop-check-${randomUUID()}`;
async function call(action, args = {}, context = contextId) {
  const response = await fetch(access.url + '/e2b/request', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { authorization: `Bearer ${access.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, args, contextId: context }),
  });
  const data = await response.json();
  return { status: response.status, data };
}
const initial = await call('inspect');
assert.equal(initial.status, 200);
assert.equal(initial.data.state, 'stopped', 'An existing desktop is active; leave it untouched');
let started = false;
try {
  const start = await call('status');
  assert.equal(start.status, 200); started = true;
  assert.ok(start.data.expiresAt > Date.now());
  assert.equal((await call('inspect')).data.state, 'ready');
  assert.equal((await call('inspect', {}, 'another-bot')).data.state, 'in_use');
  assert.equal((await call('screenshot', {}, 'another-bot')).status, 409);
  assert.equal((await call('stop', {}, 'another-bot')).status, 409);
  const command = await call('run_command', { command: 'printf CLAWD_E2B_READY' });
  assert.equal(command.status, 200); assert.equal(command.data.stdout, 'CLAWD_E2B_READY');
  const screenshot = await call('screenshot');
  assert.equal(screenshot.status, 200); assert.equal(screenshot.data.format, 'png');
  const bytes = Buffer.from(screenshot.data.image_base64, 'base64');
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await mkdir('.cache/hosted-computer-check', { recursive: true, mode: 0o700 });
  await writeFile('.cache/hosted-computer-check/panel-gateway.png', bytes, { mode: 0o600 });
  console.log(JSON.stringify({ inspect: 'passed', contextIsolation: 'passed', command: 'passed', screenshotBytes: bytes.length }));
} finally {
  if (started) {
    const stop = await call('stop'); assert.equal(stop.status, 200); assert.equal(stop.data.stopped, true);
    assert.equal((await call('inspect')).data.state, 'stopped');
    console.log(JSON.stringify({ cleanup: 'stopped' }));
  }
}

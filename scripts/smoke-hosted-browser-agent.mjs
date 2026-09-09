import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const [rawOrigin, clientFile, stateFile, action = 'poll'] = process.argv.slice(2);
const origin = new URL(rawOrigin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an HTTPS gateway origin');
if (!stateFile || !['start', 'poll', 'follow-up'].includes(action)) throw new Error('Provide a state file and start, poll, or follow-up action');
const token = /^SAND_HOSTED_GATEWAY_TOKEN=([A-Za-z0-9_-]{32,128})$/m.exec(await readFile(clientFile, 'utf8'))?.[1];
if (!token) throw new Error('Client file lacks gateway token');
process.env.SAND_HOSTED_GATEWAY_URL = origin.origin;
process.env.SAND_HOSTED_GATEWAY_TOKEN = token;
const temporary = await mkdtemp(join(tmpdir(), 'browser-agent-smoke-'));
try {
  const output = join(temporary, 'browser.cjs');
  await build({ entryPoints: ['source/node-agent-coordinator/browser-use-tools.ts'], outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const bridge = createRequire(import.meta.url)(output);
  if (action === 'start') {
    // Reserve the state file first. An uncertain create must never start a
    // second paid run merely because observation failed.
    await writeFile(stateFile, JSON.stringify({ phase: 'creating' }), { flag: 'wx', mode: 0o600 });
    const created = await bridge.executeBrowserUseRoutedTool('browseruse_run_task', {
      task: 'Visit https://example.com and report its page title. Read only: do not follow links, sign in, send messages, or submit forms.',
      wait: false,
    });
    if (typeof created?.id !== 'string') throw new Error('No run identifier returned; reconcile the creation before retrying');
    await writeFile(stateFile, JSON.stringify({ id: created.id, phase: 'started' }), { mode: 0o600 });
    console.log('Browser-agent smoke started; run identifier saved for polling.');
  } else if (action === 'follow-up') {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    if (state.phase !== 'completed' || !state.sessionId) throw new Error('Follow-up needs a completed observed session');
    await writeFile(stateFile, JSON.stringify({ ...state, phase: 'queueing' }), { mode: 0o600 });
    await bridge.executeBrowserUseRoutedTool('browseruse_follow_up', { session_id: state.sessionId, text: 'Verify the page title by reading document.title or the HTML title element for https://example.com with a browser tool. Return that exact title, not the hostname. Do not sign in, send messages, or submit forms.' });
    await writeFile(stateFile, JSON.stringify({ ...state, phase: 'follow-up' }), { mode: 0o600 });
    console.log('Follow-up queued for the existing owned session.');
  } else {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    if (!state.id) throw new Error('Creation outcome is unknown; do not restart without reconciliation');
    if (['queueing', 'follow-up'].includes(state.phase)) {
      const session = await bridge.executeBrowserUseRoutedTool('browseruse_session_status', { session_id: state.sessionId });
      if (session.latestRunId === state.id) { console.log('Follow-up has not become the latest run yet.'); process.exitCode = 0; }
      if (session.latestRunId === state.id) { await rm(temporary, { recursive: true, force: true }); process.exit(0); }
      state.id = session.latestRunId; state.phase = 'started';
      await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    }
    const status = await bridge.executeBrowserUseRoutedTool('browseruse_task_status', { id: state.id });
    const terminal = ['completed', 'failed', 'cancelled'].includes(status?.status);
    if (!terminal) { console.log(JSON.stringify({ terminal: false, status: status?.status })); }
    else {
      const result = await bridge.executeBrowserUseRoutedTool('browseruse_task_result', { id: state.id });
      const pass = status.status === 'completed' && JSON.stringify(result).includes('Example Domain');
      await writeFile(stateFile, JSON.stringify({ id: state.id, sessionId: result.sessionId, phase: status.status, verified: pass }), { mode: 0o600 });
      console.log(JSON.stringify({ terminal: true, status: status.status, verifiedPageTitle: pass }));
      if (!pass && status.status === 'completed') console.log(JSON.stringify({ publicSmokeResult: typeof result.result === 'string' ? result.result.slice(0, 600) : null }));
      if (!pass) process.exitCode = 1;
    }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }

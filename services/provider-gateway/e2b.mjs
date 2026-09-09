const TIMEOUT = 15 * 60_000;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const actions = ['inspect', 'status', 'stop', 'screenshot', 'click', 'type', 'key', 'scroll', 'drag', 'run_command'];
export function e2bRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['action', 'args', 'contextId'].includes(k)) || !actions.includes(body.action)) fail('Invalid desktop request');
  if (body.contextId !== undefined && (typeof body.contextId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.contextId))) fail('Invalid desktop context');
  const args = body.args ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('Invalid desktop arguments');
  const allowed = { inspect: [], status: [], stop: [], screenshot: [], click: ['x','y','button','count'], type: ['text'], key: ['keys'], scroll: ['direction','amount'], drag: ['from_x','from_y','to_x','to_y'], run_command: ['command'] }[body.action];
  if (Object.keys(args).some(k => !allowed.includes(k))) fail('Unsupported desktop argument');
  const point = (key, max) => { if (!Number.isInteger(args[key]) || args[key] < 0 || args[key] >= max) fail('Invalid desktop coordinate'); };
  if (body.action === 'click') {
    point('x',1280); point('y',800);
    if (args.button !== undefined && !['left','right','middle'].includes(args.button)) fail('Invalid button');
    if (args.count !== undefined && ![1,2].includes(args.count)) fail('Invalid click count');
  }
  if (body.action === 'drag') { point('from_x',1280); point('to_x',1280); point('from_y',800); point('to_y',800); }
  for (const key of ['text','keys','command']) if (allowed.includes(key) && (typeof args[key] !== 'string' || !args[key].length || args[key].length > (key === 'keys' ? 256 : 16384))) fail('Invalid desktop text');
  if (body.action === 'scroll' && ((args.direction !== undefined && !['up','down'].includes(args.direction)) || (args.amount !== undefined && (!Number.isInteger(args.amount) || args.amount < 1 || args.amount > 15)))) fail('Invalid scroll');
  return { action: body.action, args, contextId: body.contextId ?? '' };
}

export async function executeDesktop(request, user, store, { apiKey, now = Date.now, sdk } = {}) {
  const { action, args, contextId = '' } = request;
  let saved = store.desktop(user.id);
  if (action === 'inspect') {
    if (!saved || saved.expiresAt <= now()) return { state: 'stopped', resolution: [1280,800] };
    if ((saved.contextId ?? '') !== contextId) return { state: 'in_use', expiresAt: saved.expiresAt, resolution: [1280,800] };
    return { state: saved.id ? 'ready' : 'pending', expiresAt: saved.expiresAt, resolution: [1280,800] };
  }
  if (saved && saved.expiresAt > now() && (saved.contextId ?? '') !== contextId) fail('This account desktop is in use by another bot or session; stop it there first', 409);
  if (!saved || saved.expiresAt <= now()) {
    if (action === 'stop') return { stopped: true };
    if (action !== 'status') fail('Start a desktop with e2b_computer_status first', 409);
    const expiresAt = now() + TIMEOUT;
    if (!store.reserveDesktop(user.id, now(), expiresAt, contextId)) fail('Desktop creation already pending', 409);
    sdk ??= (await import('@e2b/desktop')).Sandbox;
    // Do not forward process.env, caller credentials, templates, or network overrides.
    // A failed/uncertain create retains its reservation until expiry; never retry it automatically.
    const sandbox = await sdk.create({ apiKey, resolution: [1280,800], dpi: 96, timeoutMs: TIMEOUT, requestTimeoutMs: 30_000, envs: {}, secure: true });
    try {
      store.claim(user.id, 'e2b', [{ kind: 'sandbox', id: sandbox.sandboxId }]);
      store.bindDesktop(user.id, expiresAt, sandbox.sandboxId);
    } catch (error) { await sandbox.kill().catch(() => {}); throw error; }
    return { sandboxId: sandbox.sandboxId, resolution: [1280,800], streamUrl: null, expiresAt, note: 'Use screenshots to view this private desktop. It expires after 15 minutes.' };
  }
  if (!saved.id) fail('Desktop creation outcome pending; wait for expiry or contact the operator', 409);
  if (!store.owns(user.id, 'e2b', 'sandbox', saved.id)) fail('Desktop unavailable', 404);
  sdk ??= (await import('@e2b/desktop')).Sandbox;
  if (action === 'stop') {
    await sdk.kill(saved.id, { apiKey, requestTimeoutMs: 30_000 });
    store.clearDesktop(user.id, saved.id);
    return { stopped: true };
  }
  if (action === 'status') return { sandboxId: saved.id, resolution: [1280,800], streamUrl: null, expiresAt: saved.expiresAt };
  const sandbox = await sdk.connect(saved.id, { apiKey, requestTimeoutMs: 30_000, timeoutMs: Math.max(1000, saved.expiresAt - now()) });
  switch (action) {
    case 'screenshot': {
      const image = Buffer.from(await sandbox.screenshot());
      if (image.length > 6_000_000) fail('Screenshot too large', 502);
      return { format: 'png', byteLength: image.length, image_base64: image.toString('base64') };
    }
    case 'click': {
      const button = args.button ?? 'left';
      const method = button === 'left' && args.count === 2 ? 'doubleClick' : `${button}Click`;
      await sandbox[method](args.x,args.y); return { clicked: true };
    }
    case 'type': await sandbox.write(args.text); return { typed: args.text.length };
    case 'key': await sandbox.press(args.keys); return { pressed: args.keys };
    case 'scroll': await sandbox.scroll(args.direction ?? 'down',args.amount ?? 3); return { scrolled: true };
    case 'drag': await sandbox.drag([args.from_x,args.from_y],[args.to_x,args.to_y]); return { dragged: true };
    case 'run_command': {
      let result;
      try { result = await sandbox.commands.run(args.command, { timeoutMs: 30_000, requestTimeoutMs: 35_000 }); }
      catch (error) {
        // SDK command exits are normal sandbox results, not API/auth failures.
        if (error?.name !== 'CommandExitError' || !Number.isInteger(error.exitCode) || typeof error.stdout !== 'string' || typeof error.stderr !== 'string') throw error;
        result = error;
      }
      return { exitCode: result.exitCode ?? null, stdout: (result.stdout ?? '').slice(0,65536), stderr: (result.stderr ?? '').slice(0,65536) };
    }
  }
}

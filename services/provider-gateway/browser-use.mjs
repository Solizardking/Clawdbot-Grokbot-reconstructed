const ID = '[A-Za-z0-9_-]{1,128}';
const error = (status, message) => Object.assign(new Error(message), { status });
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 16000;

export function browserUseRequest(input, user, store, model = 'gpt-5.6-luna') {
  if (!input || typeof input !== 'object') throw error(400, 'Invalid browser request');
  const { method, path } = input;
  const body = input.body ?? {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'Invalid browser body');
  if (method === 'POST' && path === '/runs') {
    if (!text(body.task)) throw error(400, 'Task is required');
    if (body.model !== undefined && body.model !== model) throw error(400, `Hosted Browser Use model is ${model}`);
    return { method, path, kind: 'run', create: true, body: { task: body.task, model, maxCostUsd: 1, agentmail: false } };
  }
  if (method === 'POST' && path === '/browsers') {
    const country = body.proxyCountryCode ?? null;
    if (country !== null && !/^[a-z]{2}$/.test(country)) throw error(400, 'Invalid proxy country');
    return { method, path, kind: 'browser', create: true, body: { proxyCountryCode: country, timeout: 15 } };
  }
  let match;
  if (method === 'GET' && (match = new RegExp(`^/sessions/(${ID})$`).exec(path))) {
    if (!store.owns(user.id, 'browseruse', 'session', match[1])) throw error(404, 'Browser resource not found');
    return { method, path, kind: 'session', id: match[1] };
  }
  if (method === 'POST' && (match = new RegExp(`^/runs/(${ID})/cancel$`).exec(path))) {
    if (!store.owns(user.id, 'browseruse', 'run', match[1])) throw error(404, 'Browser resource not found');
    return { method, path, kind: 'cancel', id: match[1] };
  }
  if (method === 'GET' && (match = new RegExp(`^/runs/(${ID})(?:/status)?$`).exec(path))) {
    if (!store.owns(user.id, 'browseruse', 'run', match[1])) throw error(404, 'Browser resource not found');
    return { method, path, kind: 'run', id: match[1] };
  }
  if (method === 'POST' && (match = new RegExp(`^/sessions/(${ID})/queue$`).exec(path))) {
    if (!store.owns(user.id, 'browseruse', 'session', match[1])) throw error(404, 'Browser resource not found');
    if (!text(body.text)) throw error(400, 'Follow-up text is required');
    return { method, path, kind: 'queue', id: match[1], body: { text: body.text, interrupt: body.interrupt === true } };
  }
  if (method === 'PATCH' && (match = new RegExp(`^/browsers/(${ID})$`).exec(path)) && body.action === 'stop') {
    if (!store.owns(user.id, 'browseruse', 'browser', match[1])) throw error(404, 'Browser resource not found');
    return { method, path, kind: 'browser', id: match[1], body: { action: 'stop' } };
  }
  throw error(400, 'Unsupported browser operation');
}

export async function browserUseResponse(response, request, user, store) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw error(502, 'Browser response too large');
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw error(502, 'Invalid browser response');
  const failedRun = request.kind === 'run' && !request.create && ['failed', 'cancelled'].includes(payload.status);
  if (payload.error && !failedRun) throw error(502, 'Browser provider error');
  if (request.kind === 'session' || request.kind === 'queue') {
    if (payload.sessionId !== request.id) throw error(502, 'Browser session identifier mismatch');
    const id = request.kind === 'session' ? payload.latestRunId : payload.runId;
    if (id) store.claim(user.id, 'browseruse', [{ kind: 'run', id }]);
  }
  if (request.create || request.kind === 'run') {
    const resources = [];
    if (request.create) {
      if (!payload.id) throw error(502, 'Browser resource identifier missing');
      resources.push({ kind: request.kind, id: payload.id });
    } else if (payload.id && payload.id !== request.id) throw error(502, 'Browser resource identifier mismatch');
    if (request.kind === 'run') {
      if (payload.sessionId) resources.push({ kind: 'session', id: payload.sessionId });
      if (payload.workspaceId) resources.push({ kind: 'workspace', id: payload.workspaceId });
    }
    // Claims are atomic and immutable. Conflicts prevent returning any URLs
    // or content even if the provider returns a resource owned by someone else.
    store.claim(user.id, 'browseruse', resources);
  }
  // A terminal run's error is task data, not a transport failure. Preserve its
  // lifecycle so clients can stop polling, but never forward raw provider errors.
  return payload.error ? { ...payload, error: 'Browser task failed' } : payload;
}

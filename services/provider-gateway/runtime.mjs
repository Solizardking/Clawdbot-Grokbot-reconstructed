import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// The target comes only from the operator's validated, per-user assignment.
// Flycast exposes this service to the gateway network without a public IP.
export async function forwardRuntime(req, res, app, fetchImpl) {
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  res.on('close', disconnect);
  const timer = setTimeout(disconnect, 30_000);
  timer.unref();
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1_000_000) {
        res.writeHead(413, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Hosted computer requests are limited to 1 MB' }));
      }
      chunks.push(chunk);
    }
    const response = await fetchImpl(`http://${app}.flycast${req.url}`, {
      method: req.method, redirect: 'error', signal: controller.signal,
      headers: {
        authorization: req.headers.authorization,
        'content-type': req.headers['content-type'] || 'application/json',
        ...(req.headers['last-event-id'] ? { 'last-event-id': req.headers['last-event-id'] } : {}),
      },
      ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    });
    // Event streams remain connected until the client leaves. Other requests
    // retain the deadline, including their response body.
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (contentType.startsWith('text/event-stream')) clearTimeout(timer);
    if (!response.ok) {
      await response.body?.cancel();
      res.writeHead(response.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Hosted computer request failed' }));
    }
    res.writeHead(response.status, { 'content-type': contentType, 'cache-control': 'no-store' });
    res.flushHeaders();
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch {
    if (!res.headersSent && !res.destroyed) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Hosted computer is unavailable' }));
    } else res.destroy();
  } finally {
    clearTimeout(timer);
    res.off('close', disconnect);
  }
}

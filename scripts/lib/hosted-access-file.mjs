// Self-contained because this exact function is embedded in the renderer.
export function parseHostedAccessFile(contents) {
  if (typeof contents !== 'string' || contents.length > 16384) throw new Error('Invalid hosted access file');
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^(SAND_HOSTED_GATEWAY_URL|SAND_HOSTED_GATEWAY_TOKEN|OPENROUTER_MODEL)=(.*)$/.exec(line);
    if (!match) continue;
    if (Object.hasOwn(values,match[1])) throw new Error('Duplicate hosted access setting');
    values[match[1]] = match[2].trim();
  }
  let url;
  try { url = new URL(values.SAND_HOSTED_GATEWAY_URL); } catch { throw new Error('Invalid gateway URL in access file'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Access file requires an HTTPS gateway origin');
  const token = values.SAND_HOSTED_GATEWAY_TOKEN;
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token ?? '')) throw new Error('Invalid gateway token in access file');
  const model = values.OPENROUTER_MODEL || 'openrouter/free';
  if (!/^[A-Za-z0-9_./:-]{1,200}$/.test(model)) throw new Error('Invalid gateway model in access file');
  return { url:url.origin, token, model };
}

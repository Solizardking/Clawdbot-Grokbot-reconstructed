// Read-only project verification. Provider credentials never enter argv or logs.
if (!process.stdin.isTTY) throw new Error('Run in a TTY for hidden key input');
process.stdin.setRawMode(true);
console.log('Ready for hidden Composio key input.');
const key = await new Promise((resolve, reject) => {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
    if (input.includes('\u0003') || input.length > 4096) {
      process.stdin.setRawMode(false); process.stdin.pause(); reject(new Error('Input cancelled')); return;
    }
    if (/[\r\n]/.test(input)) { process.stdin.setRawMode(false); process.stdin.pause(); resolve(input.trim()); }
  });
});
for (const path of [
  '/connected_accounts/ca_Omr3yvw7x5TI',
  '/tools/CUSTOM_SOLGPT_RESOLVE_TOKEN?version=20260824_02',
  '/tools/CUSTOM_SOLGPT_GET_IMPERIAL_STATS_SUMMARY?version=20260824_02',
]) {
  const response = await fetch(`https://backend.composio.dev/api/v3.1${path}`, {
    headers: { 'x-api-key': key }, signal: AbortSignal.timeout(20000), redirect: 'error',
  });
  const body = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ path, status: response.status, keys: Object.keys(body),
    userId: body.user_id, authConfig: body.auth_config ? {id:body.auth_config.id,authScheme:body.auth_config.auth_scheme} : undefined, statusValue: body.status, id: body.id, slug: body.slug, name: body.name, toolkit: body.toolkit ? {slug:body.toolkit.slug} : undefined,
    input: body.input_parameters, description: body.description, authScheme: body.auth_scheme, enabled: body.is_enabled_for_tool_router,
    items: body.items?.map(item => ({ id: item.id, slug: item.slug, name: item.name, status: item.status,
      toolkit: item.toolkit, userId: item.user_id, version: item.version, tags: item.tags })),
    error: response.ok ? undefined : String(body.error?.message ?? body.message ?? 'Request failed').replaceAll(key, '[redacted]'),
  }));
}

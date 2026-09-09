export const HELIUS_READ_METHODS = new Set([
  'getBalance', 'getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts',
  'getTokenAccountsByOwner', 'getTokenAccountsByDelegate', 'getTokenSupply',
  'getTokenLargestAccounts', 'getSignaturesForAddress', 'getTransaction',
  'getLatestBlockhash', 'isBlockhashValid', 'getBlockHeight', 'getEpochInfo',
  'getMinimumBalanceForRentExemption', 'getFeeForMessage', 'getVersion', 'getHealth',
  'getSignatureStatuses', 'getAsset', 'getAssetsByOwner', 'searchAssets', 'getAssetProof',
]);

export function heliusRequest(body) {
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || !HELIUS_READ_METHODS.has(body.method) ||
      !(typeof body.id === 'string' || Number.isSafeInteger(body.id)) ||
      (body.params !== undefined && (body.params === null || typeof body.params !== 'object'))) return null;
  return { jsonrpc: '2.0', id: body.id, method: body.method, params: body.params ?? [] };
}

export async function heliusResponse(response, id) {
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('RPC response too large');
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!payload || payload.error || !Object.hasOwn(payload, 'result')) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: 'RPC request failed' } };
  }
  return { jsonrpc: '2.0', id, result: payload.result };
}

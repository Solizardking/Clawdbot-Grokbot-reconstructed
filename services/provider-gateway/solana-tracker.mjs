// Provider URLs are resolved only from the operator's private environment.
export function solanaTrackerEndpoint(env) {
  const value = env.SOLANA_TRACKER_SECURE_RPC?.trim() || env.SOLANA_TRACKER_RPC_URL?.trim() || env.SOLANA_RPC_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname !== '/' ||
        !(url.hostname === 'rpc-mainnet.solanatracker.io' || /^[a-z0-9-]+\.secure\.rpc\.solanatracker\.io$/.test(url.hostname))) return null;
    return url.href;
  } catch { return null; }
}

export const SOLANA_TRACKER_READ_METHODS = new Set([
  'getBalance', 'getAccountInfo', 'getMultipleAccounts', 'getTokenAccountsByOwner',
  'getTokenAccountBalance', 'getTokenSupply', 'getTokenLargestAccounts',
  'getSignaturesForAddress', 'getTransaction', 'getLatestBlockhash', 'isBlockhashValid',
  'getBlockHeight', 'getEpochInfo', 'getMinimumBalanceForRentExemption', 'getFeeForMessage',
  'getRecentPrioritizationFees', 'getVersion', 'getHealth', 'getSlot', 'getSignatureStatuses',
]);

export function solanaTrackerRequest(body) {
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || !SOLANA_TRACKER_READ_METHODS.has(body.method) ||
      !(typeof body.id === 'string' || Number.isSafeInteger(body.id)) ||
      (typeof body.id === 'string' && body.id.length > 128) ||
      (body.params !== undefined && (!Array.isArray(body.params) || body.params.length > 4))) return null;
  return { jsonrpc: '2.0', id: body.id, method: body.method, params: body.params ?? [] };
}

export type PumpToken = {
  mint: string; name: string; symbol: string; description: string;
  marketCapSol: number | null; hasGithub: boolean; receivedAt: number;
};
export function parsePumpToken(value: unknown, now = Date.now()): PumpToken | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.type !== 'token-launch' || typeof row.mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)) return null;
  const text = (key: string, fallback = '') => typeof row[key] === 'string' ? (row[key] as string).slice(0, 1200) : fallback;
  return { mint: row.mint, name: text('name', 'Unnamed token'), symbol: text('symbol', '—'), description: text('description'), marketCapSol: typeof row.marketCapSol === 'number' && Number.isFinite(row.marketCapSol) && row.marketCapSol >= 0 ? row.marketCapSol : null, hasGithub: row.hasGithub === true, receivedAt: now };
}
export function mergePumpToken(rows: PumpToken[], token: PumpToken): PumpToken[] {
  return [token, ...rows.filter(row => row.mint !== token.mint)].slice(0, 120);
}

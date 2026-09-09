import { describe, expect, it } from 'vitest';
import { mergePumpToken, parsePumpToken } from './pump-feed';
const mint = 'So11111111111111111111111111111111111111112';
describe('native pump feed', () => {
  it('rejects malformed messages and unsafe mint links', () => {
    for (const value of [null, [], { type: 'status' }, { type: 'token-launch', mint: 'javascript:alert(1)' }]) expect(parsePumpToken(value)).toBeNull();
  });
  it('keeps zero market caps and distinguishes missing values', () => {
    expect(parsePumpToken({ type: 'token-launch', mint, marketCapSol: 0 })?.marketCapSol).toBe(0);
    expect(parsePumpToken({ type: 'token-launch', mint, marketCapSol: Infinity })?.marketCapSol).toBeNull();
  });
  it('deduplicates by mint even without signatures and bounds memory', () => {
    const token = parsePumpToken({ type: 'token-launch', mint }, 100)!;
    expect(mergePumpToken([token], { ...token, name: 'Updated' })).toEqual([{ ...token, name: 'Updated' }]);
    const rows = Array.from({ length: 120 }, (_, i) => ({ ...token, mint: String(i) }));
    expect(mergePumpToken(rows, token)).toHaveLength(120);
  });
});

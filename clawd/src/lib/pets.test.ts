import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { DEFAULT_PET, FRAMES, ROWS, packPet, unpackPet, validateManifest } from './pets';
import { spinnerThemes, spinnerPhrase } from './spinners';

describe('Codex pet packages', () => {
  it('imports the supplied real Clawd package and round trips exported bytes', () => {
    const source = readFileSync(new URL('../../public/pets/clawd/clawd-codex.zip', import.meta.url));
    const pet = unpackPet(source);
    expect(pet.manifest.displayName).toBe('Clawd');
    expect(pet.bytes.length).toBeGreaterThan(1000000);
    const again = unpackPet(packPet(pet.manifest, pet.bytes));
    expect(again.manifest).toEqual(pet.manifest);
    // Compare the full sprite bytes without building a multi-million-element
    // deep-equality traversal in the test runner.
    expect(Buffer.from(again.bytes).equals(Buffer.from(pet.bytes))).toBe(true);
  });
  it('rejects traversal, remote sheets, unsupported versions and missing images', () => {
    expect(() => validateManifest({ ...DEFAULT_PET.manifest, spritesheetPath: '../x.webp' })).toThrow();
    expect(() => validateManifest({ ...DEFAULT_PET.manifest, spritesheetPath: 'https://example.com/x.webp' })).toThrow();
    expect(() => validateManifest({ ...DEFAULT_PET.manifest, spriteVersionNumber: 2 })).toThrow();
    expect(() => unpackPet(zipSync({ 'pet.json': strToU8(JSON.stringify(DEFAULT_PET.manifest)) }))).toThrow(/missing/);
    expect(() => unpackPet(zipSync({ '../pet.json': strToU8('{}') }))).toThrow(/Unsafe/);
  });
  it('rejects ambiguous archives and excessive expansion', () => {
    expect(() => unpackPet(zipSync({ 'a/pet.json': strToU8('{}'), 'b/pet.json': strToU8('{}') }))).toThrow(/exactly one/);
    expect(() => unpackPet(zipSync({ 'spritesheet.png': new Uint8Array(13 * 1024 * 1024) }))).toThrow(/limit/);
  });
  it('defines nine animations without walking into empty atlas cells', () => {
    expect(ROWS).toHaveLength(9); expect(FRAMES).toEqual([6,8,8,4,5,8,6,6,6]);
  });
});
describe('spinner catalog', () => {
  it('loads all 45 themes and wraps phrases with a known fallback', () => {
    expect(spinnerThemes).toHaveLength(45);
    for (const theme of spinnerThemes) expect(spinnerPhrase(theme.id, theme.verbs.length)).toBe(theme.verbs[0]);
    expect(spinnerPhrase('unknown',0)).toBe(spinnerPhrase('sol-gpt',0));
  });
});

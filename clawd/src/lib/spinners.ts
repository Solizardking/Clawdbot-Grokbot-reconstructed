const packs = import.meta.glob('./spinner-packs/*.json', { eager: true, import: 'default' });
export const spinnerThemes = Object.entries(packs).flatMap(([path, raw]) => {
  const pack = raw as { spinnerVerbs?: { verbs?: unknown[] } };
  const verbs = pack.spinnerVerbs?.verbs?.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length < 200);
  return verbs?.length ? [{ id: path.split('/').pop()!.replace('.json', ''), verbs }] : [];
}).sort((a,b) => a.id.localeCompare(b.id));
export function spinnerPhrase(theme: string, tick: number): string {
  const pack = spinnerThemes.find(p => p.id === theme) ?? spinnerThemes.find(p => p.id === 'sol-gpt');
  return pack?.verbs[tick % pack.verbs.length] ?? 'Working';
}

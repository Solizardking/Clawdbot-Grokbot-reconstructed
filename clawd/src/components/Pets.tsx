import { useEffect, useState } from 'react';
import { useStore, useStreaming } from '@/state/store';
import { DEFAULT_PET, FRAMES, ROWS, generatePet, importPet, packPet, type Pet, type Pose } from '@/lib/pets';
import { deletePet, listPets, preferences, savePet, savePreferences, type PetPreferences } from '@/lib/pet-storage';
import { spinnerPhrase, spinnerThemes } from '@/lib/spinners';
import { Card } from './SettingsPrimitives';

function usePets() {
  const [pets, setPets] = useState<Pet[]>([DEFAULT_PET]);
  const [prefs, setPrefs] = useState(preferences);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => { setPrefs(preferences()); listPets().then(p => { if (alive) { setPets(p); setError(''); } }).catch(e => { if (alive) setError(e.message); }); };
    refresh(); window.addEventListener('clawd-pets-changed', refresh); window.addEventListener('storage', refresh);
    return () => { alive = false; window.removeEventListener('clawd-pets-changed', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  return { pets, prefs, error, selected: pets.find(p => p.manifest.id === prefs.selected) ?? DEFAULT_PET };
}
export function PetSprite({ pet, pose = 'idle', size = 80 }: { pet: Pet; pose?: Pose; size?: number }) {
  const [frame, setFrame] = useState(0);
  const row = ROWS.indexOf(pose);
  useEffect(() => {
    setFrame(0);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const timer = setInterval(() => { if (!document.hidden && !motion.matches) setFrame(f => (f + 1) % FRAMES[row]); else setFrame(0); }, 160);
    return () => clearInterval(timer);
  }, [row, pet.image]);
  return <div role="img" aria-label={`${pet.manifest.displayName}, ${pose}`} style={{ width: size, height: size * 208 / 192, backgroundImage: `url(${JSON.stringify(pet.image)})`, backgroundSize: `${size * 8}px ${size * 208 / 192 * 9}px`, backgroundPosition: `${-(frame % FRAMES[row]) * size}px ${-row * size * 208 / 192}px`, imageRendering: 'pixelated' }} />;
}
export function PetCompanion() {
  const { state, dispatch } = useStore();
  const { streaming } = useStreaming();
  const { prefs, selected } = usePets();
  const [tick, setTick] = useState(0);
  const group = state.groups.find(g => g.id === state.selectedId);
  const bot = state.bots.find(b => b.id === (group?.busyBotId ?? state.selectedId));
  const busy = !!bot?.busy || bot?.activity === 'working';
  useEffect(() => { if (!busy) { setTick(0); return; } const timer = setInterval(() => { if (!document.hidden) setTick(t => t + 1); }, 3500); return () => clearInterval(timer); }, [busy, prefs.spinner]);
  if (!prefs.enabled || state.activeView !== 'chat') return null;
  const pose: Pose = bot?.activity === 'dead' ? 'failed' : bot?.activity === 'waiting-on-you' ? 'waiting' : streaming[group?.threadId ?? bot?.threadId ?? ''] ? 'review' : busy ? 'running' : 'idle';
  const label = pose === 'failed' ? 'Bot offline' : pose === 'waiting' ? 'Waiting for you' : busy ? spinnerPhrase(prefs.spinner, tick) : selected.manifest.displayName;
  return <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline/30 bg-app px-4 text-ink-secondary">
    <span className="truncate text-xs" title={label}>{label}</span>
    <button aria-label="Open pet settings" title="Customize your pet and spinner" onClick={() => dispatch({ type: 'toggleAppSettings', open: true, section: 'pets' })}><PetSprite pet={selected} pose={pose} size={42} /></button>
  </div>;
}
const control = 'rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-sm text-ink';
export function PetsSettings() {
  const { pets, prefs, selected, error: storageError } = usePets();
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [name, setName] = useState('My pet'); const [seed, setSeed] = useState('little space lobster'); const [color, setColor] = useState('#a78bfa'); const [art, setArt] = useState<File>(); const [preview, setPreview] = useState<Pet>(); const [pose, setPose] = useState<Pose>('idle');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch(e) { setError(e instanceof Error ? e.message : 'Pet operation failed.'); } finally { setBusy(false); } };
  const update = (patch: Partial<PetPreferences>) => { try { savePreferences({ ...prefs, ...patch }); } catch { setError('Preferences could not be saved. Browser storage may be disabled.'); } };
  const keep = async (pet: Pet) => { const saved = await savePet(pet); savePreferences({ ...prefs, selected: saved.manifest.id, enabled: true }); setNotice(`${saved.manifest.displayName} saved and selected.`); };
  return <>
    <Card title="Your companion" subtitle="Clawd and your own animated pets. Saved in this browser or desktop profile.">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.enabled} onChange={e => update({ enabled: e.target.checked })} /> Show pet below chat</label>
      <div className="my-3 flex items-center gap-4"><PetSprite pet={selected} pose={pose} size={96} /><div><strong>{selected.manifest.displayName}</strong><p className="text-xs text-ink-secondary">{selected.manifest.description}</p></div></div>
      <label className="flex flex-col gap-1 text-sm">Pet<select aria-label="Pet" className={control} value={selected.manifest.id} onChange={e => update({ selected: e.target.value })}>{pets.map(p => <option key={p.manifest.id} value={p.manifest.id}>{p.manifest.displayName}</option>)}</select></label>
      <label className="mt-2 flex flex-col gap-1 text-sm">Preview animation<select aria-label="Preview animation" className={control} value={pose} onChange={e => setPose(e.target.value as Pose)}>{ROWS.map(r => <option key={r}>{r}</option>)}</select></label>
      <div className="mt-3 flex gap-2"><button className={control} disabled={busy} onClick={() => void run(async () => {
        const response = await fetch(selected.image); if (!response.ok) throw new Error('Could not load pet artwork.');
        const zip = packPet(selected.manifest, new Uint8Array(await response.arrayBuffer()));
        const url = URL.createObjectURL(new Blob([new Uint8Array(zip)], { type: 'application/zip' }));
        const link = document.createElement('a'); link.href = url; link.download = `${selected.manifest.id}-codex.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      })}>Export Codex ZIP</button>
      {selected.manifest.id !== 'clawd' && <button className={control} disabled={busy} onClick={() => void run(async () => { await deletePet(selected.manifest.id); savePreferences({ ...prefs, selected: 'clawd' }); })}>Delete pet</button>}</div>
    </Card>
    <Card title="Create a pet" subtitle="Generate a pixel creature locally from a seed and color, or animate your own artwork. No API key needed.">
      <div className="flex flex-col gap-3">
        <label className="text-sm">Name<input className={`${control} mt-1 w-full`} maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="text-sm">Design seed<input className={`${control} mt-1 w-full`} maxLength={100} value={seed} onChange={e => setSeed(e.target.value)} /></label>
        <label className="flex items-center gap-3 text-sm">Color<input aria-label="Pet color" type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
        <label className="text-sm">Optional artwork (PNG or WebP)<input className="mt-1 block w-full text-xs" type="file" accept="image/png,image/webp" onChange={e => setArt(e.target.files?.[0])} /></label>
        {art && <button className={control} onClick={() => setArt(undefined)}>Use generated pixels instead</button>}
        <button className={control} disabled={busy} onClick={() => void run(async () => setPreview(await generatePet(name, seed, color, art)))}>{busy ? 'Working…' : 'Generate preview'}</button>
        {preview && <div className="flex items-center gap-3"><PetSprite pet={preview} pose={pose} size={96} /><button className={control} disabled={busy} onClick={() => void run(async () => { await keep(preview); setPreview(undefined); })}>Save and use {preview.manifest.displayName}</button></div>}
      </div>
    </Card>
    <Card title="Import a Codex pet" subtitle="Select a pet ZIP, or select pet.json and its PNG/WebP spritesheet together. Supports Codex v1 packages (1536 × 1872).">
      <input aria-label="Import Codex pet files" className="w-full text-sm" type="file" multiple accept=".zip,.json,.png,.webp" disabled={busy} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void run(async () => keep(await importPet(files))); }} />
    </Card>
    <Card title="Spinner themes" subtitle={`${spinnerThemes.length} themes from SOL-GPT. Phrases rotate while your bot works.`}>
      <label className="flex flex-col gap-2 text-sm">Theme<select aria-label="Theme" className={control} value={prefs.spinner} onChange={e => update({ spinner: e.target.value })}>{spinnerThemes.map(p => <option key={p.id} value={p.id}>{p.id.replaceAll('-', ' ')}</option>)}</select></label>
      <p className="mt-3 text-sm text-ink-secondary">{spinnerPhrase(prefs.spinner, 0)}…</p>
    </Card>
    {(error || storageError) && <p role="alert" className="text-sm text-red-400">{error || storageError}</p>}
    {notice && <p role="status" className="text-sm text-ink-secondary">{notice}</p>}
  </>;
}

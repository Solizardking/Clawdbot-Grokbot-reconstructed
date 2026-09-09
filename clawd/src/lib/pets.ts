import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export const ROWS = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'] as const;
export type Pose = typeof ROWS[number];
export const FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6];
export interface PetManifest { id: string; displayName: string; description: string; spriteVersionNumber: 1; spritesheetPath: string }
export interface Pet { manifest: PetManifest; image: string }
export const DEFAULT_PET: Pet = { manifest: { id: 'clawd', displayName: 'Clawd', description: 'Original neon voxel lobster by @clawddevs.', spriteVersionNumber: 1, spritesheetPath: 'spritesheet.webp' }, image: './pets/clawd/spritesheet.webp' };
const LIMIT = 12 * 1024 * 1024;
export function validateManifest(value: unknown): PetManifest {
  const m = value as Partial<PetManifest> | null;
  if (!m || !/^[a-zA-Z0-9_-]{1,64}$/.test(m.id ?? '') || typeof m.displayName !== 'string' || !m.displayName.trim() || m.displayName.length > 80 || typeof m.description !== 'string' || m.description.length > 1000 || m.spriteVersionNumber !== 1 || typeof m.spritesheetPath !== 'string' || !/^[\w.-]+\.(png|webp)$/i.test(m.spritesheetPath)) throw new Error('Expected a Codex v1 pet.json with a name and a local PNG or WebP spritesheet.');
  return m as PetManifest;
}
export function unpackPet(bytes: Uint8Array): { manifest: PetManifest; bytes: Uint8Array } {
  if (bytes.length > LIMIT) throw new Error('Pet ZIP must be smaller than 12 MB.');
  let total = 0;
  const files = unzipSync(bytes, { filter: f => {
    total += f.originalSize;
    if (total > LIMIT * 2 || f.originalSize > LIMIT) throw new Error('Pet ZIP expands beyond the 24 MB limit.');
    if (f.name.startsWith('/') || f.name.split('/').some(p => p === '..' || p.includes('\\'))) throw new Error('Unsafe archive path.');
    return /(^|\/)pet\.json$|\.(png|webp)$/i.test(f.name);
  } });
  const manifests = Object.keys(files).filter(k => /(^|\/)pet\.json$/.test(k));
  if (manifests.length !== 1) throw new Error('Import one pet at a time: the ZIP must contain exactly one pet.json.');
  const path = manifests[0];
  const manifest = validateManifest(JSON.parse(strFromU8(files[path])));
  const sprite = files[path.slice(0, path.lastIndexOf('/') + 1) + manifest.spritesheetPath];
  if (!sprite) throw new Error('The spritesheet referenced by pet.json is missing.');
  return { manifest, bytes: sprite };
}
export function packPet(manifest: PetManifest, bytes: Uint8Array) {
  validateManifest(manifest);
  return zipSync({ [`${manifest.id}/pet.json`]: strToU8(JSON.stringify(manifest, null, 2)), [`${manifest.id}/${manifest.spritesheetPath}`]: bytes });
}
export async function readImage(blob: Blob): Promise<HTMLImageElement> {
  if (blob.size > LIMIT) throw new Error('Images must be smaller than 12 MB.');
  const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((v,i) => signature[i] === v);
  const webp = strFromU8(signature.slice(0,4)) === 'RIFF' && strFromU8(signature.slice(8,12)) === 'WEBP';
  if (!png && !webp) throw new Error('Use PNG or WebP artwork.');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('Image dimensions must be at most 4096 × 4096.');
    return image;
  } catch { throw new Error('Use a valid PNG or WebP image up to 4096 × 4096.'); }
  finally { URL.revokeObjectURL(url); }
}
export async function importPet(files: File[]): Promise<Pet> {
  let manifest: PetManifest, sprite: Blob;
  const zip = files.find(f => /\.zip$/i.test(f.name));
  if (zip) {
    if (zip.size > LIMIT) throw new Error('Pet ZIP must be smaller than 12 MB.');
    const unpacked = unpackPet(new Uint8Array(await zip.arrayBuffer()));
    manifest = unpacked.manifest; sprite = new Blob([new Uint8Array(unpacked.bytes)], { type: manifest.spritesheetPath.endsWith('.png') ? 'image/png' : 'image/webp' });
  } else {
    const json = files.find(f => f.name === 'pet.json');
    if (!json || json.size > 8192) throw new Error('Select pet.json and its spritesheet together, or select a Codex pet ZIP.');
    manifest = validateManifest(JSON.parse(await json.text()));
    const file = files.find(f => f.name === manifest.spritesheetPath);
    if (!file) throw new Error(`Also select ${manifest.spritesheetPath}.`);
    sprite = file;
  }
  const img = await readImage(sprite);
  if (img.naturalWidth !== 1536 || img.naturalHeight !== 1872) throw new Error('Codex v1 spritesheets must be 1536 × 1872 (8 columns × 9 rows).');
  return { manifest, image: await dataUrl(sprite) };
}
export function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Could not read image.')); r.readAsDataURL(blob); });
}
// Local procedural generator: seeded pixel creatures, or animated user artwork.
export async function generatePet(name: string, seed: string, color: string, artwork?: File): Promise<Pet> {
  if (!name.trim()) throw new Error('Give your pet a name.');
  const source = artwork ? await readImage(artwork) : null;
  const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 1872;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable.');
  let hash = 2166136261; for (const c of seed) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const pixels = Array.from({ length: 35 }, (_, i) => ((hash >>> (i % 24)) & 1) === 1);
  ROWS.forEach((pose, row) => {
    for (let frame = 0; frame < FRAMES[row]; frame++) {
      const phase = frame / FRAMES[row] * Math.PI * 2;
      ctx.save(); ctx.translate(frame * 192 + 96, row * 208 + 110 + Math.sin(phase) * (pose === 'jumping' ? 18 : 4));
      if (pose === 'running-left') ctx.scale(-1, 1);
      ctx.rotate(Math.sin(phase) * (pose === 'failed' ? .18 : .04));
      if (source) {
        const scale = Math.min(136 / source.naturalWidth, 152 / source.naturalHeight);
        ctx.drawImage(source, -source.naturalWidth * scale / 2, -source.naturalHeight * scale / 2, source.naturalWidth * scale, source.naturalHeight * scale);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(-40, -38, 80, 76);
        pixels.forEach((on, i) => { if (on) { const x = i % 5 * 10; const y = Math.floor(i / 5) * 10 - 38; ctx.fillRect(x, y, 10, 10); ctx.fillRect(-x - 10, y, 10, 10); } });
        ctx.fillRect(-50, pose === 'waving' ? -55 - Math.sin(phase) * 12 : -5, 15, 30);
        ctx.fillRect(35, -5, 15, 30);
        ctx.fillRect(-30, 30 + Math.sin(phase) * 7, 20, 18); ctx.fillRect(10, 30 - Math.sin(phase) * 7, 20, 18);
        ctx.fillStyle = '#fff'; ctx.fillRect(-28, -20, 18, pose === 'waiting' ? 5 : 18); ctx.fillRect(10, -20, 18, pose === 'waiting' ? 5 : 18);
        ctx.fillStyle = '#182033'; ctx.fillRect(-20, -15, 8, 9); ctx.fillRect(12, -15, 8, 9); ctx.fillRect(-10, 15, 20, 5);
        if (pose === 'review' || pose === 'running') { ctx.fillStyle = '#94a3b8'; ctx.fillRect(-38, 28, 76, 28); ctx.fillStyle = '#182033'; ctx.fillRect(-32, 32, 64, 18); }
      }
      ctx.restore();
    }
  });
  return { manifest: { id: `pet-${crypto.randomUUID()}`, displayName: name.trim().slice(0,80), description: source ? 'Created from your artwork.' : `Locally generated pixel pet. Seed: ${seed.slice(0,100)}`, spriteVersionNumber: 1, spritesheetPath: 'spritesheet.png' }, image: canvas.toDataURL('image/png') };
}

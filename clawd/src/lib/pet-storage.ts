import { DEFAULT_PET, type Pet } from './pets';
export interface PetPreferences { selected: string; enabled: boolean; spinner: string }
const defaults: PetPreferences = { selected: 'clawd', enabled: true, spinner: 'sol-gpt' };
export function preferences(): PetPreferences {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('clawd-pet-preferences') || '{}') }; } catch { return defaults; }
}
export function savePreferences(value: PetPreferences) { localStorage.setItem('clawd-pet-preferences', JSON.stringify(value)); window.dispatchEvent(new Event('clawd-pets-changed')); }
function db(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => { const r = indexedDB.open('clawd-pets', 1); r.onupgradeneeded = () => r.result.createObjectStore('pets', { keyPath: 'manifest.id' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new Error('Pet storage is unavailable.')); });
}
async function transaction<T>(mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve,reject) => { const t = database.transaction('pets', mode); const r = action(t.objectStore('pets')); t.oncomplete = () => { database.close(); resolve(r.result); }; t.onerror = t.onabort = () => { database.close(); reject(new Error('Could not save pets. Check available browser storage.')); }; });
}
export async function listPets(): Promise<Pet[]> { return [DEFAULT_PET, ...await transaction('readonly', s => s.getAll()) as Pet[]]; }
export async function savePet(pet: Pet) {
  // Preserve the built-in Clawd entry when importing a package with the same id.
  if (pet.manifest.id === 'clawd') pet = { ...pet, manifest: { ...pet.manifest, id: `clawd-${crypto.randomUUID()}` } };
  await transaction('readwrite', s => s.put(pet)); return pet;
}
export async function deletePet(id: string) { await transaction('readwrite', s => s.delete(id)); window.dispatchEvent(new Event('clawd-pets-changed')); }

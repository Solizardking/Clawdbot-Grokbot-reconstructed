import { mkdir, readdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here,'../..');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--build')) throw new Error('Usage: node services/desktop-runtime/stage.mjs [--build]');
let source = join(root,'.build/fidelity-clean-runtime/dist');
if (args[0] === '--build') {
  const { buildFidelityDistribution } = await import('../../scripts/clean-build.mjs');
  const built = await buildFidelityDistribution({ outputRoot: join(root,'.build/desktop-runtime') });
  if (!built.hostActivation?.clean) throw new Error('Hosted runtime requires validated production bindings');
  source = join(built.outputRoot,'dist');
}
const target = join(here,'runtime');
const files = [];
async function collect(directory, prefix) {
  for (const item of await readdir(directory,{withFileTypes:true})) {
    if (item.isDirectory()) await collect(join(directory,item.name),`${prefix}/${item.name}`);
    else if (item.isFile() && item.name.endsWith('.cjs')) files.push(`${prefix}/${item.name}`);
  }
}
await collect(join(source,'host'),'host');
await collect(join(source,'box-exec-daemon'),'box-exec-daemon');
if (!files.includes('host/host-main.cjs') || !files.includes('box-exec-daemon/main.cjs')) throw new Error('Run npm run package before staging the runtime');
// Copy executable build artifacts only, never desktop state, sessions, or env files.
await rm(target,{recursive:true,force:true});
const inventory = [];
for (const file of files.sort()) {
  const bytes = await readFile(join(source,file));
  await mkdir(dirname(join(target,file)),{recursive:true});
  await writeFile(join(target,file),bytes);
  inventory.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await copyFile(join(root,'node_modules/tree-sitter/binding.gyp'),join(target,'tree-sitter.binding.gyp'));
const binding = await readFile(join(target,'tree-sitter.binding.gyp'));
if (createHash('sha256').update(binding).digest('hex') !== '8f7eb83b314277458e41d0096c03d58849c2921ee8705b14376b712e1eb647d4') throw new Error('Unexpected native-parser build patch');
await writeFile(join(target,'inventory.json'),JSON.stringify(inventory,null,2)+'\n');
console.log(`Staged ${files.length} reconstructed runtime bundles; no credentials copied.`);

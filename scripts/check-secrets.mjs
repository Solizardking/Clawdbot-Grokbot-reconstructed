import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectLocalSecrets, inspectBytes, isPrivatePath } from './lib/secret-audit.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
const secrets = collectLocalSecrets(root);
const entries = git(['ls-files', '--stage', '-z']).toString().split('\0').filter(Boolean);
let failures = 0;
const checked = new Set();
for (const entry of entries) {
  const [meta, file] = entry.split('\t');
  const [mode, oid] = meta.split(' ');
  if (mode === '160000') continue;
  if (isPrivatePath(file)) { console.error(`${file}: private configuration must not be tracked`); failures++; continue; }
  const target = resolve(root, file);
  const variants = [];
  let work;
  if (existsSync(target) && !lstatSync(target).isSymbolicLink()) work = readFileSync(target);
  const matchesIndex = work && createHash('sha1').update(`blob ${work.length}\0`).update(work).digest('hex') === oid;
  if (!checked.has(oid)) {
    checked.add(oid);
    variants.push(['index', matchesIndex ? work : git(['cat-file', 'blob', oid])]);
  }
  if (work && !matchesIndex) variants.push(['worktree', work]);
  for (const [scope, bytes] of variants) {
    const findings = inspectBytes(bytes, secrets);
    if (findings.length) { console.error(`${file} [${scope}]: ${findings.join(', ')}`); failures++; }
  }
}
for (const file of git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean)) {
  const target = resolve(root, file);
  if (!existsSync(target) || lstatSync(target).isSymbolicLink()) continue;
  const findings = isPrivatePath(file) ? ['unignored private configuration'] : inspectBytes(readFileSync(target), secrets);
  if (findings.length) { console.error(`${file} [untracked]: ${findings.join(', ')}`); failures++; }
}
console.log(`Secret check: ${entries.length} tracked entries; ${failures} findings. Values are never printed.`);
process.exitCode = failures ? 1 : 0;

// Only generated reconstruction builds and explicitly named app backups.
// .cache also contains signing material and live configuration: never wipe it.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/clean-obsolete-builds.mjs [--apply]');
const targets = ['.build', 'dist', 'clawd/work/Clawd Bot.backup.app'];
const cache = join(root, '.cache');
if (existsSync(cache) && !lstatSync(cache).isSymbolicLink()) {
  for (const name of readdirSync(cache)) {
    if (/^clawd-(?:before-.+\.app|installed-backup-\d+\.app|brand-backup-\d+-(?:installed|release)|installed-ui-backup)$/.test(name)) {
      targets.push(`.cache/${name}`);
    }
  }
}
const present = targets.filter(target => existsSync(join(root, target)));
// Validate the entire plan before removing anything.
for (const target of present) {
  const tracked = execFileSync('git', ['ls-files', '--', target], { cwd: root, encoding: 'utf8' });
  if (tracked.trim()) throw new Error(`Refusing to remove tracked content: ${target}`);
  let current = root;
  for (const component of target.split('/')) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${current}`);
  }
}
for (const target of present) {
  if (args.includes('--apply')) rmSync(join(root, target), { recursive: true, force: false });
  console.log(`${args.includes('--apply') ? 'Removed' : 'Would remove'} ${target}`);
}
console.log(`${present.length} obsolete build locations; current clawd/release and private cache state preserved.`);

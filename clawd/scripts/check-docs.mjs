// Validate local documentation references without fetching URLs or reading env files.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
const failures = [];
let count = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.md')) {
      count++;
      const body = readFileSync(path, 'utf8');
      for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1].replace(/^<|>$/g, '').split(/\s+["']/)[0].split('#')[0];
        if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target)) continue;
        if (!existsSync(resolve(dirname(path), decodeURIComponent(target)))) failures.push(`${relative(root, path)}: missing ${target}`);
      }
      // Historical plans retain their original commands; native/Worker package scripts are separate.
      if (dirname(path) === resolve(root, 'docs')) {
        for (const match of body.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
          if (!scripts[match[1]] && !['check'].includes(match[1])) failures.push(`${relative(root, path)}: unknown root script ${match[1]}`);
        }
      }
    }
  }
}
walk(resolve(root, 'docs'));
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Checked ${count} Markdown files: local links and root npm script references passed.`);

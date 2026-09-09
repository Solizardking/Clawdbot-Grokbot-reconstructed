// A source-only snapshot: never copy Git history or ignored local data.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dest = args[0] === '--export' ? resolve(args[1] ?? 'publication/clawd') : null;
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root }).toString().split('\0').filter(Boolean))];
const forbidden = /(^|\/)(node_modules|\.git|\.cache|\.build|\.wrangler|dist-ui|dist-server|dist-companion|dist-native|release)(\/|$)|(^|\/)\.dev\.vars(?!\.example$)|(^|\/)\.env(?!\.example$)|-keypair\.json$|\.(?:pem|p12|pfx)$/;
const errors = [];
for (const file of files) {
  if (forbidden.test(file)) errors.push(`${file}: private or generated path`);
  const full = resolve(root, file);
  if (!existsSync(full)) continue; // An unstaged deletion is omitted from a worktree snapshot.
  const stat = lstatSync(full);
  if (stat.isSymbolicLink()) errors.push(`${file}: symlink is not a portable source file`);
  if (stat.size > 50 * 1024 * 1024) errors.push(`${file}: larger than 50 MiB`);
  if (stat.isFile() && stat.size < 5 * 1024 * 1024 && !/\.(png|ico|icns|woff2|jpg|jpeg|pdf)$/.test(file)) {
    const body = readFileSync(full, 'utf8');
    if (!['electron/diagnostics.test.mjs', 'server/redact.test.ts'].includes(file) && (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body) || /gh[pousr]_[A-Za-z0-9]{30,}/.test(body))) errors.push(`${file}: credential pattern`);
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (dest) {
  if (existsSync(dest)) throw new Error('Export destination must not exist; choose a fresh directory.');
  const rel = relative(root, dest);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith('publication/'))) throw new Error('Use publication/ or a destination outside the repository.');
  mkdirSync(dest, { recursive: true });
  for (const file of files) { if (!existsSync(resolve(root, file))) continue; const to = resolve(dest, file); mkdirSync(dirname(to), { recursive: true }); cpSync(resolve(root, file), to); }
  console.log(`Exported ${files.length} source files to ${dest}; no Git history included.`);
} else console.log(`Checked ${files.length} publishable files. This checks the current tree, not Git history or credential validity.`);

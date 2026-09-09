// Prepare a reviewable public package from the worktree plus fresh runtime outputs.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const destination = join(root, 'publication', 'npm-current');
const forbidden = /(^|\/)(node_modules|\.git|\.cache|\.build|\.wrangler|\.vercel|publication|release|work|reports|coverage)(\/|$)|(^|\/)\.env(?!\.example$)|(^|\/)\.dev\.vars(?!\.example$)|\.env$|(?:-keypair\.json|\.pem|\.p12|\.pfx|\.tsbuildinfo|\.log)$/;
const secrets = [];
for (const name of ['.env', '.env.local', '../.env', '../.env.local', '../deploy/openrouter.env']) {
  const file = join(root, name);
  if (!existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    // This is the public Solana mint displayed in the UI, not an access token.
    if (key === 'CLAWD_TOKEN_ADDRESS') continue;
    if (key === 'JUPITER_TOKENS_BASE' && value === 'https://api.jup.ag/tokens/v2') continue;
    if (value.length >= 16 && (/KEY|TOKEN|SECRET|PASSWORD|SECURE_RPC/i.test(key) || /api[_-]key=/.test(value))) secrets.push(Buffer.from(value));
  }
}
function inspect(file, relative) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error(`Symlink needs explicit review: ${relative}`);
  if (!stat.isFile()) return;
  const bytes = readFileSync(file);
  if (secrets.some(value => bytes.includes(value))) throw new Error(`Local credential found in ${relative}`);
  if (!/\.(png|jpe?g|ico|icns|woff2?|pdf)$/.test(relative)) {
    const text = bytes.toString('utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) && !/\.test\./.test(relative)) throw new Error(`Private key found in ${relative}`);
  }
}
const files = new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd:root}).toString().split('\0').filter(Boolean));
for (const dir of ['dist-ui', 'dist-server', 'dist-companion', 'electron/vendor']) {
  if (!existsSync(join(root, dir))) throw new Error(`Build first: missing ${dir}`);
  function walk(relative) {
    for (const entry of readdirSync(join(root, relative), {withFileTypes:true})) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next); else files.add(next);
    }
  }
  walk(dir);
}
const included = [...files].filter(file => !forbidden.test(file) && existsSync(join(root,file))).sort();
for (const file of included) inspect(join(root, file), file);
rmSync(destination, {recursive:true,force:true});
mkdirSync(destination, {recursive:true});
for (const file of included) {
  const target = join(destination, file);
  mkdirSync(dirname(target), {recursive:true});
  cpSync(join(root,file), target);
}
manifest.private = false;
manifest.bin = {'clawd-bot':'bin/clawd-bot.mjs'};
manifest.publishConfig = {access:'public', registry:'https://registry.npmjs.org/'};
manifest.files = ['**/*', '.github/**', '.node-version'];
writeFileSync(join(destination,'package.json'), JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(destination,'.npmignore'), '# This staging tree was explicitly selected and scanned.\n');
writeFileSync(join(destination,'PUBLICATION.json'), JSON.stringify({name:manifest.name,version:manifest.version,sourceFiles:included.length,includes:['source worktree','built UI','bundled server','companion','updater'],excludes:['private environment files','installed dependencies','machine caches','local work data','old exports and releases','platform-specific native bundles']},null,2)+'\n');
console.log(destination);

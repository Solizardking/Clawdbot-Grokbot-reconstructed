import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseEnv } from 'node:util';

export function isPrivatePath(file) {
  const name = basename(file);
  if (/\.(example|sample|template)$/.test(name)) return false;
  return /^(\.env(?:\.|$)|\.dev\.vars(?:\.|$)|id_rsa(?:\.|$)|id_ed25519(?:\.|$))/.test(name)
    || /\.env(?:\.|$)|\.(pem|key|p12|pfx|keystore|jks)$|(?:^|[-_])keypair\.json$|^(wallet|credentials)\.json$|^service-account.*\.json$/.test(name);
}

export function collectLocalSecrets(root) {
  const values = new Map();
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/^(node_modules|\.git|\.cache|\.build|\.next|\.venv|venv|work|release|publication|dist.*|build|third_party)$/.test(entry.name)) walk(file);
      } else if (isPrivatePath(file) && /env|dev\.vars/.test(entry.name)) {
        for (const [key, raw] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
          if (/^(VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_)/.test(key) || /TOKEN_ADDRESS|MIN_BALANCE|ADMIN_WALLETS/.test(key)) continue;
          if (!/API_?KEY|ACCESS_KEY|(?:^|_)KEY$|TOKEN(?:$|_)|SECRET|PASSWORD|CREDENTIAL|SECURE_RPC|DATABASE_URL|RPC_URL|WSS_URL|DEPOSIT_CODE/i.test(key)) continue;
          if (raw.length < 12 || /example|placeholder|your[_-]|replace[_-]|^\$|^<|^https?:\/\/localhost/i.test(raw)) continue;
          if (/URL|RPC|WSS/.test(key)) {
            try {
              const url = new URL(raw);
              if (url.password) values.set(decodeURIComponent(url.password), key);
              for (const [param, value] of url.searchParams) if (/key|token|secret/i.test(param) && value.length >= 12) values.set(value, key);
              if (!url.search && !url.password && !/SECURE_RPC/.test(key)) continue;
            } catch { /* Non-URL secret: compare the full value. */ }
          }
          values.set(raw, key);
        }
      }
    }
  }
  walk(root);
  return [...values].map(([value, key]) => ({ value: Buffer.from(value), key }));
}

// Reviewed synthetic diagnostic fixtures, plus cloudflared's public sample hello key.
// Upstream: https://github.com/cloudflare/cloudflared/blob/master/tlsconfig/hello_ca.go
const inertFixtureHashes = new Set(['17ac4c2ca3deb87202cd2c101d4da9d4f4c0ec3d51a0381729329102b28e61a4', '1effd13de9f75696d5ba3c3f65dd6793faacce7883fed4846a618471e1266698', '47f4ebdc7b354eda0cc065d709ffc86a0aeecf5196944bd21e124114438cdcaf']);
const patterns = [
  ['provider credential', /\b(?:sk-(?:proj-|or-v1-|ant-api\d\d-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g],
  ['Telegram credential', /\b[0-9]{8,12}:[A-Za-z0-9_-]{35}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const compiledSecrets = new WeakMap();
export function inspectBytes(bytes, secrets = []) {
  const findings = [];
  const text = bytes.toString('utf8');
  if (secrets.length) {
    let compiled = compiledSecrets.get(secrets);
    if (!compiled) {
      const labels = new Map(secrets.map(secret => [secret.value.toString('utf8'), secret.key]));
      const pattern = new RegExp([...labels.keys()].map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
      compiled = {labels, pattern};
      compiledSecrets.set(secrets, compiled);
    }
    compiled.pattern.lastIndex = 0;
    for (const match of text.matchAll(compiled.pattern)) findings.push(`local credential (${compiled.labels.get(match[0])})`);
  }
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      // Only explicit inert fixtures are exempt; do not exempt whole test files.
      if (/example|placeholder|dummy|fake|xxxxx/i.test(match[0])) continue;
      if (inertFixtureHashes.has(createHash('sha256').update(match[0]).digest('hex'))) continue;
      findings.push(label);
    }
  }
  return [...new Set(findings)];
}

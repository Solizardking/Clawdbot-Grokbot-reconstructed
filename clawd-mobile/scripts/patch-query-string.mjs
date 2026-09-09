// Expo Router 57 still expects query-string's CommonJS namespace. Keep that
// public API while loading the patched ESM URI decoder (GHSA-vcc3-ghjq-m6fr).
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url),
  file = require.resolve('query-string')
let source = await readFile(file, 'utf8')
const old = "const decodeComponent = require('decode-uri-component');"
const fixed =
  "const decodeModule = require('decode-uri-component');\nconst decodeComponent = decodeModule.default ?? decodeModule;"
if (source.includes(old)) await writeFile(file, source.replace(old, fixed))
else if (!source.includes(fixed)) throw new Error('Review the URI decoder patch after upgrading query-string')

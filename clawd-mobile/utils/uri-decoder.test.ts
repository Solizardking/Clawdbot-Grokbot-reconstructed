import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
it('keeps Expo Router query-string behavior with the patched URI decoder', () => {
  const qs = require('query-string')
  expect({ ...qs.parse('q=hello%20world&token=SOL&repeat=a&repeat=b') }).toEqual({
    q: 'hello world',
    token: 'SOL',
    repeat: ['a', 'b'],
  })
  expect(qs.stringify({ q: 'hello world', token: 'SOL' })).toBe('q=hello%20world&token=SOL')
  const start = performance.now()
  expect(() => qs.parse('q=' + ('%' + 'A'.repeat(100)).repeat(100))).not.toThrow()
  expect(performance.now() - start).toBeLessThan(1000)
})

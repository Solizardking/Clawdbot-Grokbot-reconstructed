import { expect, it, vi, afterEach } from 'vitest'
import { accessToken, gatewayRequest, jsonRequest, nativeRequest, validMarket } from './clawd-api'
import { createRequire } from 'node:module'
import { GATEWAY_ORIGIN } from '../constants/endpoints'
afterEach(() => vi.unstubAllGlobals())
it('times out with the AbortController shipped by React Native', async () => {
  const native = createRequire(import.meta.url)('abort-controller')
  vi.stubGlobal('AbortController', native.AbortController)
  vi.stubGlobal('AbortSignal', native.AbortSignal)
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('Request aborted')))
        }),
    ),
  )
  try {
    const check = expect(jsonRequest(GATEWAY_ORIGIN + '/v1/account')).rejects.toThrow('Request aborted')
    await vi.advanceTimersByTimeAsync(45000)
    await check
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
it('accepts only Clawd account access and refuses access files for another server', () => {
  const token = 'a'.repeat(43)
  expect(accessToken(token)).toBe(token)
  expect(accessToken(`SAND_HOSTED_GATEWAY_URL=${GATEWAY_ORIGIN}\nSAND_HOSTED_GATEWAY_TOKEN=${token}`)).toBe(token)
  expect(() =>
    accessToken(`SAND_HOSTED_GATEWAY_URL=https://attacker.example\nSAND_HOSTED_GATEWAY_TOKEN=${token}`),
  ).toThrow()
  expect(() => accessToken('nvapi-provider-key')).toThrow()
})
it('sends credentials only to fixed service paths and never ambient cookies', async () => {
  const mock = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', mock)
  await gatewayRequest('test-token', '/v1/account')
  expect(mock.mock.calls[0][0]).toBe(GATEWAY_ORIGIN + '/v1/account')
  expect(mock.mock.calls[0][1]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
    headers: { authorization: 'Bearer test-token' },
  })
  expect(() => gatewayRequest('test-token', 'https://attacker.example')).toThrow()
  expect(() => nativeRequest('../../elsewhere')).toThrow()
})
it('rejects a price response for another mint or an untrusted source', () => {
  const m = {
    address: 'mint-a',
    sourceUrl: 'https://www.geckoterminal.com/solana/pools/pool',
    retrievedAt: new Date().toISOString(),
    candles: [],
    priceUsd: null,
    priceChange24hPercent: null,
    poolLiquidityUsd: null,
    poolVolume24hUsd: null,
  }
  expect(validMarket(m, 'mint-a')).toBe(m)
  expect(() => validMarket(m, 'mint-b')).toThrow()
  expect(() => validMarket({ ...m, sourceUrl: 'https://attacker.example' }, 'mint-a')).toThrow()
  expect(() => validMarket({ ...m, sourceUrl: 'http://www.geckoterminal.com' }, 'mint-a')).toThrow()
  expect(() => validMarket({ ...m, priceUsd: -1 }, 'mint-a')).toThrow()
})

import { GATEWAY_ORIGIN, SITE_ORIGIN } from '@/constants/endpoints'
export type WalletSession = { wallet: string; token: string; expiresAt: number }
export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export type Market = {
  name: string
  symbol: string
  address: string
  priceUsd: number | null
  priceChange24hPercent: number | null
  source: string
  sourceUrl: string
  retrievedAt: string
  poolLiquidityUsd: number | null
  poolVolume24hUsd: number | null
  candles: { time: number; close: number }[]
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export async function jsonRequest(url: string, init: RequestInit = {}) {
  // React Native uses abort-controller, which has no AbortSignal.timeout().
  const controller = init.signal ? undefined : new AbortController()
  const timer = controller ? setTimeout(() => controller.abort(), 45000) : undefined
  try {
    const response = await fetch(url, {
      ...init,
      credentials: 'omit',
      redirect: 'error',
      signal: init.signal ?? controller!.signal,
    })
    if (!response.ok)
      throw new ApiError(
        response.status,
        response.status === 401
          ? 'Your session or access code expired. Connect again.'
          : response.status === 403
            ? 'This account does not have access to that service.'
            : response.status === 429
              ? 'Request limit reached. Please wait and retry.'
              : `Service unavailable (${response.status}). Please retry.`,
      )
    const raw = await response.text()
    if (raw.length > 2_000_000) throw new Error('Response was too large')
    return JSON.parse(raw)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
export function nativeRequest(
  path: string,
  body?: unknown,
  token?: string,
  method = body === undefined ? 'GET' : 'POST',
) {
  if (!['challenge', 'verify', 'session'].includes(path)) throw new Error('Invalid account operation')
  return jsonRequest(`${SITE_ORIGIN}/api/auth/native/${path}`, {
    method,
    headers: {
      'x-clawd-client': 'android-v1',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
export function accessToken(input: string) {
  const value = input.trim()
  const token = value.includes('SAND_HOSTED_GATEWAY_TOKEN=')
    ? value
        .split(/\r?\n/)
        .find((line) => line.startsWith('SAND_HOSTED_GATEWAY_TOKEN='))
        ?.slice('SAND_HOSTED_GATEWAY_TOKEN='.length)
        .trim()
    : value
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token ?? ''))
    throw new Error('Enter your Clawd account access code, not a provider API key.')
  const url = value
    .split(/\r?\n/)
    .find((line) => line.startsWith('SAND_HOSTED_GATEWAY_URL='))
    ?.slice('SAND_HOSTED_GATEWAY_URL='.length)
    .trim()
  if (url && url.replace(/\/$/, '') !== GATEWAY_ORIGIN) throw new Error('This access file belongs to another gateway.')
  return token!
}
export function gatewayRequest(token: string, path: string, body?: unknown, signal?: AbortSignal) {
  if (!/^\/(v1\/account|(openrouter|nvidia|novita|xai)\/v1\/(models|chat\/completions)|market\/request)$/.test(path))
    throw new Error('Unsupported service')
  return jsonRequest(GATEWAY_ORIGIN + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  })
}
export function validMarket(value: unknown, mint: string): Market {
  const m = value as Market
  let source: URL | undefined
  try {
    source = new URL(m?.sourceUrl)
  } catch {}
  if (
    !m ||
    m.address !== mint ||
    typeof m.sourceUrl !== 'string' ||
    source?.hostname !== 'www.geckoterminal.com' ||
    source.protocol !== 'https:' ||
    source.username !== '' ||
    source.password !== '' ||
    !Number.isFinite(Date.parse(m.retrievedAt)) ||
    !Array.isArray(m.candles) ||
    [m.priceUsd, m.poolLiquidityUsd, m.poolVolume24hUsd].some((v) => v !== null && (!Number.isFinite(v) || v < 0)) ||
    (m.priceChange24hPercent !== null && !Number.isFinite(m.priceChange24hPercent)) ||
    m.candles.some((c) => !Number.isFinite(c.time) || !Number.isFinite(c.close) || c.close < 0)
  )
    throw new Error('Market data did not match the selected token')
  return m
}

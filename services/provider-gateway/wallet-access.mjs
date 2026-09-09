import { createHash } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';

const providers = ['openrouter', 'nvidia', 'novita', 'xai'];
const services = ['market', 'tavily', 'birdeye', 'solana', 'pump', 'media', 'e2b', 'browseruse', 'helius'];
const modelPattern = /^[A-Za-z0-9_./:-]{1,200}$/;

export function createWalletAccessVerifier(env, now = Date.now) {
  const fields = [env.GATEWAY_WALLET_ISSUER, env.GATEWAY_WALLET_JWKS_JSON, env.GATEWAY_WALLET_PLANS_JSON];
  if (fields.every(value => !value)) return async () => undefined;
  if (fields.some(value => !value)) throw new Error('Wallet access requires issuer, public JWKS and plan policies');
  const issuer = new URL(fields[0]);
  if (issuer.protocol !== 'https:' || issuer.origin !== fields[0]) throw new Error('Wallet issuer must be an HTTPS origin');
  const jwks = JSON.parse(fields[1]);
  if (!Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.some(key => key.kty !== 'RSA' || ['d','p','q','dp','dq','qi','oth'].some(field => field in key) || key.alg !== 'RS256' || typeof key.kid !== 'string'))
    throw new Error('Configure public RS256 wallet verification keys');
  const key = createLocalJWKSet(jwks), plans = JSON.parse(fields[2]);
  if (!plans || Array.isArray(plans) || typeof plans !== 'object') throw new Error('Invalid wallet plan registry');
  for (const [id, plan] of Object.entries(plans)) {
    if (!/^[a-z0-9_-]{1,64}$/.test(id) || !plan || Object.keys(plan).some(k => !['models', 'chatModels', 'services', 'dailyRequests'].includes(k)) ||
      !Array.isArray(plan.models) || !plan.models.length || plan.models.length > 100 || plan.models.some(m => typeof m !== 'string' || !modelPattern.test(m)) ||
      !Array.isArray(plan.services) || plan.services.some(s => !services.includes(s)) ||
      !Number.isSafeInteger(plan.dailyRequests) || plan.dailyRequests < 1 || plan.dailyRequests > 10000 ||
      !plan.chatModels || Array.isArray(plan.chatModels) || typeof plan.chatModels !== 'object' ||
      Object.entries(plan.chatModels).some(([p, models]) => !providers.includes(p) || !Array.isArray(models) || models.some(m => !plan.models.includes(m))))
      throw new Error('Invalid wallet plan policy');
  }
  let active = 0;
  return async token => {
    if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || active >= 8) return undefined;
    active++;
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['RS256'], issuer: issuer.origin, audience: 'clawd-gateway',
        typ: 'JWT', requiredClaims: ['sub', 'exp', 'iat', 'jti', 'role', 'plan'], maxTokenAge: '5m', currentDate: new Date(now()) });
      if (payload.role !== 'gateway' || typeof payload.sub !== 'string' || !/^wallet:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payload.sub) ||
        !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.exp <= payload.iat || payload.exp - payload.iat > 300 ||
        typeof payload.jti !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.jti) || typeof payload.plan !== 'string' || !Object.hasOwn(plans, payload.plan)) return undefined;
      // Policy comes from the gateway, never from model/service claims supplied by a client.
      // Wallet-derived IDs keep quota and resource ownership stable across token renewals.
      return { ...plans[payload.plan], id: 'wallet:' + createHash('sha256').update(payload.sub).digest('hex'), expiresAt: payload.exp * 1000 };
    } catch { return undefined; }
    finally { active--; }
  };
}

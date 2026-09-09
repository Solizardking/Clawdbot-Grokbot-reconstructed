import type {AuthConfig} from 'convex/server';
const issuer=process.env.SITE_ORIGIN;
const jwks=process.env.SITE_JWKS_JSON;
if(!issuer||!jwks)throw new Error('Set SITE_ORIGIN and SITE_JWKS_JSON in the Clawd Convex deployment');
export default {providers:[{type:'customJwt',issuer,applicationID:'clawd-site',algorithm:'RS256',jwks:'data:application/json;base64,'+btoa(jwks)}]} satisfies AuthConfig;

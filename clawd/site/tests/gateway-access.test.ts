import {afterEach,expect,it,vi} from 'vitest';
import {generateKeyPair,exportPKCS8,exportJWK,SignJWT,jwtVerify} from 'jose';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import schema from '../convex/schema';
import {issueGatewayAccess,gatewayAccessResponse} from '../lib/gateway-access';
import {createWalletAccessVerifier} from '../../../services/provider-gateway/wallet-access.mjs';
import {createGateway} from '../../../services/provider-gateway/server.mjs';
const modules=import.meta.glob('../convex/**/*.ts');
const accessRef=makeFunctionReference<'mutation'>('identity:gatewayAccess');
const wallet='11111111111111111111111111111111',issuer='https://clawd.example';
const tokenHash='a'.repeat(64);
const plan={models:['openrouter/free'],chatModels:{openrouter:['openrouter/free']},services:['market'],dailyRequests:1};
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});

async function keys(){
  const pair=await generateKeyPair('RS256',{extractable:true});
  vi.stubEnv('SITE_ORIGIN',issuer);vi.stubEnv('AUTH_KEY_ID','test-key');vi.stubEnv('AUTH_PRIVATE_KEY_PEM',await exportPKCS8(pair.privateKey));
  return {pair,env:{GATEWAY_WALLET_ISSUER:issuer,GATEWAY_WALLET_JWKS_JSON:JSON.stringify({keys:[{...await exportJWK(pair.publicKey),kid:'test-key',alg:'RS256'}]}),GATEWAY_WALLET_PLANS_JSON:JSON.stringify({monthly:plan})}};
}

it('issues access only for a live session and active subscription, with bounded renewals',async()=>{
  const t=convexTest(schema,modules),service=t.withIdentity({subject:'service:clawd-site',role:'service'}),now=Date.now();
  const ids=await t.run(async ctx=>{
    const userId=await ctx.db.insert('users',{wallet,createdAt:now,lastLoginAt:now});
    const sessionId=await ctx.db.insert('sessions',{tokenHash,userId,createdAt:now,expiresAt:now+600000});
    return {userId,sessionId};
  });
  await expect(t.mutation(accessRef,{tokenHash})).rejects.toThrow('Unauthorized');
  expect(await service.mutation(accessRef,{tokenHash:'b'.repeat(64)})).toBeNull();
  expect(await service.mutation(accessRef,{tokenHash})).toEqual({status:'subscription_required'});
  const subscriptionId=await t.run(ctx=>ctx.db.insert('subscriptions',{userId:ids.userId,planId:'monthly',expiresAt:now+90000,updatedAt:now,lastPaymentId:'test-payment'}));
  const grant=await service.mutation(accessRef,{tokenHash});
  expect(grant).toMatchObject({status:'ready',wallet,planId:'monthly',expiresAt:now+90000});
  for(let i=1;i<12;i++)expect((await service.mutation(accessRef,{tokenHash})).status).toBe('ready');
  expect(await service.mutation(accessRef,{tokenHash})).toEqual({status:'rate_limited'});
  await t.run(ctx=>ctx.db.patch(subscriptionId,{expiresAt:now-1}));
  expect(await service.mutation(accessRef,{tokenHash})).toEqual({status:'subscription_required'});
  await t.run(ctx=>ctx.db.patch(ids.sessionId,{revokedAt:now}));
  expect(await service.mutation(accessRef,{tokenHash})).toBeNull();
});

it('binds grants to issuer, audience, expiry and configured plan; token claims cannot widen access',async()=>{
  const {pair,env}=await keys();let now=Date.now();
  const verify=createWalletAccessVerifier(env,()=>now);
  const grant=await issueGatewayAccess({wallet,planId:'monthly',expiresAt:now+90000},now);
  const user=await verify(grant.token);
  expect(user).toMatchObject({...plan,expiresAt:grant.expiresAt});
  const next=await issueGatewayAccess({wallet,planId:'monthly',expiresAt:now+90000},now);
  expect((await verify(next.token))?.id).toBe(user?.id);
  expect((await jwtVerify(grant.token,pair.publicKey)).payload.exp!-(await jwtVerify(grant.token,pair.publicKey)).payload.iat!).toBeLessThanOrEqual(90);
  const sign=(overrides:Record<string,unknown>={})=>new SignJWT({sub:'wallet:'+wallet,iss:issuer,aud:'clawd-gateway',iat:Math.floor(now/1000),exp:Math.floor(now/1000)+300,jti:'x'.repeat(43),role:'gateway',plan:'monthly',...overrides}).setProtectedHeader({alg:'RS256',typ:'JWT',kid:'test-key'}).sign(pair.privateKey);
  for(const override of [{aud:'clawd-site'},{iss:'https://attacker.example'},{role:'wallet'},{plan:'owner'},{exp:Math.floor(now/1000)+301},{iat:Math.floor(now/1000)+60}])expect(await verify(await sign(override))).toBeUndefined();
  const widened=await verify(await sign({services:['composio'],models:['expensive'],dailyRequests:99999}));
  expect(widened?.services).toEqual(['market']);expect(widened?.dailyRequests).toBe(1);
  expect(await verify(grant.token.slice(0,-20)+'a'.repeat(20))).toBeUndefined();
  now=grant.expiresAt;expect(await verify(grant.token)).toBeUndefined();
  expect(await createWalletAccessVerifier({})(grant.token)).toBeUndefined();
  expect(()=>createWalletAccessVerifier({...env,GATEWAY_WALLET_PLANS_JSON:JSON.stringify({monthly:{...plan,composio:{accountId:'private'}}})})).toThrow();
});

it('accepts a site-issued grant in the real gateway and shares quota across renewals',async()=>{
  const {env}=await keys(),owner='o'.repeat(43),now=Date.now();let upstreamCalls=0;
  const gateway=createGateway({env:{...env,NODE_ENV:'test',OPENROUTER_API_KEY:'test-provider-key',GATEWAY_DATABASE_PATH:':memory:',GATEWAY_USERS_JSON:JSON.stringify({[createHash('sha256').update(owner).digest('hex')]:{id:'owner',models:['owner-model']}})},fetchImpl:async()=>{upstreamCalls++;return Response.json({choices:[{message:{role:'assistant',content:'Test answer'}}]});}});
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
  const address=gateway.address();if(!address||typeof address==='string')throw Error('Missing test listener');
  const origin='http://127.0.0.1:'+address.port;
  const grant=()=>issueGatewayAccess({wallet,planId:'monthly',expiresAt:now+120000},now);
  try{
    const first=await grant(),second=await grant();
    const request=(token:string,path='/openrouter/v1/chat/completions',model='openrouter/free')=>fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'Hello'}]})});
    expect((await request(first.token,'/openrouter/v1/chat/completions','owner-model')).status).toBe(400);
    expect((await request(first.token,'/composio/v1/session')).status).toBe(403);
    expect((await request(first.token)).status).toBe(200);
    expect((await request(second.token)).status).toBe(429);expect(upstreamCalls).toBe(1);
    expect((await fetch(origin+'/v1/account',{headers:{authorization:'Bearer '+owner}})).status).toBe(200);
  }finally{gateway.closeAllConnections();await new Promise<void>(resolve=>gateway.close(()=>resolve()));}
});

it('does not open grant issuance before rollout or allow browser credentials on native routes',async()=>{
  vi.stubEnv('SITE_ORIGIN',issuer);vi.stubEnv('GATEWAY_WALLET_ACCESS_ENABLED','false');
  expect((await gatewayAccessResponse(new Request(issuer,{method:'POST',headers:{'x-clawd-client':'android-v1',authorization:'Bearer '+'x'.repeat(43)}}),true)).status).toBe(503);
  expect((await gatewayAccessResponse(new Request(issuer,{method:'POST',headers:{'x-clawd-client':'android-v1',authorization:'Bearer '+'x'.repeat(43),origin:issuer}}),true)).status).toBe(403);
  expect((await gatewayAccessResponse(new Request(issuer,{method:'POST',headers:{origin:'https://attacker.example'}}))).status).toBe(403);
});

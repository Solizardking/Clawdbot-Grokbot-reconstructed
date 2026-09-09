import { importPKCS8, SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { hash, mutationRef, opaque, serviceClient, sessionCookie } from './identity';
import { assertSameOrigin, siteOrigin } from './config';
import { assertNativeRequest, nativeSessionToken } from './native-auth';

export async function issueGatewayAccess(grant:{wallet:string;planId:string;expiresAt:number},now=Date.now()){
  const iat=Math.floor(now/1000),exp=Math.min(iat+300,Math.floor(grant.expiresAt/1000));
  if(exp<=iat||!/^wallet:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test('wallet:'+grant.wallet)||!/^[a-z0-9_-]{1,64}$/.test(grant.planId))
    throw new Error('Invalid hosted access grant');
  const pem=process.env.AUTH_PRIVATE_KEY_PEM?.replace(/\\n/g,'\n');
  if(!pem)throw new Error('Hosted access is not configured');
  const key=await importPKCS8(pem,'RS256');
  const token=await new SignJWT({role:'gateway',plan:grant.planId}).setProtectedHeader({alg:'RS256',typ:'JWT',kid:process.env.AUTH_KEY_ID??'clawd-site-1'})
    .setSubject('wallet:'+grant.wallet).setIssuer(siteOrigin()).setAudience('clawd-gateway').setJti(opaque()).setIssuedAt(iat).setExpirationTime(exp).sign(key);
  return {token,expiresAt:exp*1000,gatewayUrl:'https://grok-provider-gateway-8bit.fly.dev'};
}

export async function gatewayAccessResponse(request:Request,native=false){
  const headers={'cache-control':'no-store','pragma':'no-cache'};
  try{
    let token:string|undefined;
    if(native){assertNativeRequest(request);token=nativeSessionToken(request);}
    else{assertSameOrigin(request);token=(await cookies()).get(sessionCookie())?.value;}
    if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return Response.json({error:'Sign in with your wallet'},{status:401,headers});
    // A dedicated rollout switch keeps new grant issuance off until matching
    // gateway public keys and operator-approved plan policies are deployed.
    if(process.env.GATEWAY_WALLET_ACCESS_ENABLED!=='true')return Response.json({error:'Wallet-based hosted access is not available yet'},{status:503,headers});
    const grant=await(await serviceClient()).mutation(mutationRef('identity:gatewayAccess'),{tokenHash:hash(token)});
    if(!grant)return Response.json({error:'Sign in again'},{status:401,headers});
    if(grant.status==='subscription_required')return Response.json({error:'An active subscription is required'},{status:403,headers});
    if(grant.status==='rate_limited')return Response.json({error:'Please wait before refreshing access'},{status:429,headers:{...headers,'retry-after':'60'}});
    return Response.json(await issueGatewayAccess(grant),{headers});
  }catch(error){return Response.json({error:'Hosted access could not be verified'},{status:(error as {status?:number}).status??503,headers});}
}

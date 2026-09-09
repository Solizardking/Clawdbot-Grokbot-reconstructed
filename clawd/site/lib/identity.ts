import {createHash,randomBytes} from 'node:crypto';
import {importPKCS8,SignJWT} from 'jose';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {cookies} from 'next/headers';
import {siteOrigin} from './config';

export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const opaque=()=>randomBytes(32).toString('base64url');
export const sessionCookie=()=>process.env.NODE_ENV==='production'?'__Host-clawd_session':'clawd_session';
export const challengeCookie=()=>process.env.NODE_ENV==='production'?'__Host-clawd_login':'clawd_login';
export const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/'};
export const queryRef=(name:string)=>makeFunctionReference<'query'>(name);
export const mutationRef=(name:string)=>makeFunctionReference<'mutation'>(name);

export async function issueJwt(subject:string,role:'wallet'|'service'){
  const pem=process.env.AUTH_PRIVATE_KEY_PEM?.replace(/\\n/g,'\n');
  if(!pem)throw new Error('Wallet authentication is not configured');
  const key=await importPKCS8(pem,'RS256');
  return new SignJWT({role}).setProtectedHeader({alg:'RS256',typ:'JWT',kid:process.env.AUTH_KEY_ID??'clawd-site-1'})
    .setSubject(subject).setIssuer(siteOrigin()).setAudience('clawd-site').setIssuedAt().setExpirationTime(role==='service'?'60s':'5m').sign(key);
}
export async function serviceClient(){
  const url=process.env.NEXT_PUBLIC_CONVEX_URL;
  if(!url)throw new Error('Clawd account storage is not configured');
  const client=new ConvexHttpClient(url);client.setAuth(await issueJwt('service:clawd-site','service'));return client;
}
export async function currentSession(){
  const token=(await cookies()).get(sessionCookie())?.value;
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  const client=await serviceClient();
  return await client.query(queryRef('identity:session'),{tokenHash:hash(token)}) as {wallet:string;userId:string;expiresAt:number}|null;
}
export async function walletClient(){
  const session=await currentSession();
  if(!session)throw Object.assign(new Error('Sign in with your Solana wallet'),{status:401});
  const client=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(await issueJwt('wallet:'+session.wallet,'wallet'));return {client,session};
}

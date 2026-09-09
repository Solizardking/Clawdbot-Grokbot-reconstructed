import {NextRequest,NextResponse} from 'next/server';
import {assertSameOrigin,authConfigured,siteOrigin} from '@/lib/config';
import {cookieOptions,hash,opaque,serviceClient,mutationRef} from '@/lib/identity';
import {mobileSignInInput} from '@/lib/mobile-sign-in';
export async function POST(request:NextRequest){
  try{
    assertSameOrigin(request);if(!authConfigured())throw new Error('Not configured');
    const challengeId=opaque(),browser=opaque(),input=mobileSignInInput(siteOrigin(),hash(opaque()));
    const client=await serviceClient(),ip=request.headers.get('fly-client-ip')??'unknown-client';
    await client.mutation(mutationRef('mobileIdentity:prepare'),{challengeId,browserHash:hash(browser),rateKey:hash(process.env.AUTH_RATE_SALT+':'+ip),input:JSON.stringify(input)});
    const response=NextResponse.json({challengeId,input},{headers:{'cache-control':'no-store'}});
    response.cookies.set(process.env.NODE_ENV==='production'?'__Host-clawd_mobile':'clawd_mobile',browser,{...cookieOptions,sameSite:'strict',maxAge:300});return response;
  }catch(error){return NextResponse.json({error:'Mobile wallet login is unavailable. Try again shortly.'},{status:(error as {status?:number}).status??503});}
}

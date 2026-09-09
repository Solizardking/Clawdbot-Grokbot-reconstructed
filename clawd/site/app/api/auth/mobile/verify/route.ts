import {NextRequest,NextResponse} from 'next/server';
import {assertSameOrigin} from '@/lib/config';
import {cookieOptions,hash,opaque,serviceClient,mutationRef,queryRef,sessionCookie} from '@/lib/identity';
import {verifyMobileSignIn} from '@/lib/mobile-sign-in';
export async function POST(request:NextRequest){
  try{
    assertSameOrigin(request);const raw=await request.text();if(raw.length>8000)return NextResponse.json({error:'Request too large'},{status:413});
    const {challengeId,wallet,signedMessage,signature}=JSON.parse(raw),name=process.env.NODE_ENV==='production'?'__Host-clawd_mobile':'clawd_mobile',browser=request.cookies.get(name)?.value;
    if(typeof challengeId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(challengeId)||!browser)return NextResponse.json({error:'Prepare wallet login again'},{status:400});
    const client=await serviceClient(),browserHash=hash(browser),challenge=await client.query(queryRef('mobileIdentity:get'),{challengeId,browserHash});
    if(!challenge||!verifyMobileSignIn(JSON.parse(challenge.input),wallet,signedMessage,signature))return NextResponse.json({error:'Invalid or expired wallet signature'},{status:401});
    const token=opaque();await client.mutation(mutationRef('mobileIdentity:finish'),{challengeId,browserHash,wallet,tokenHash:hash(token)});
    const response=NextResponse.json({wallet},{headers:{'cache-control':'no-store'}});
    response.cookies.set(sessionCookie(),token,{...cookieOptions,maxAge:7*86400});response.cookies.set(name,'',{...cookieOptions,sameSite:'strict',maxAge:0});return response;
  }catch(error){return NextResponse.json({error:'Could not complete mobile wallet login. Start again.'},{status:(error as {status?:number}).status??503});}
}

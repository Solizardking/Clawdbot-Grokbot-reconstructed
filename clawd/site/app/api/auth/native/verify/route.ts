import {NextRequest,NextResponse} from 'next/server';
import {hash,opaque,serviceClient,mutationRef,queryRef} from '@/lib/identity';
import {verifyMobileSignIn} from '@/lib/mobile-sign-in';
import {assertNativeRequest,nativeProofHash} from '@/lib/native-auth';
export async function POST(request:NextRequest){
  try{
    assertNativeRequest(request);const raw=await request.text();if(raw.length>8000)return NextResponse.json({error:'Request too large'},{status:413});
    const {challengeId,clientProof,wallet,signedMessage,signature}=JSON.parse(raw),browserHash=nativeProofHash(clientProof);
    if(typeof challengeId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(challengeId))return NextResponse.json({error:'Start sign-in again'},{status:400});
    const client=await serviceClient(),challenge=await client.query(queryRef('mobileIdentity:get'),{challengeId,browserHash});
    if(!challenge||!verifyMobileSignIn(JSON.parse(challenge.input),wallet,signedMessage,signature))return NextResponse.json({error:'Invalid or expired wallet signature'},{status:401});
    const token=opaque();await client.mutation(mutationRef('mobileIdentity:finish'),{challengeId,browserHash,wallet,tokenHash:hash(token)});
    return NextResponse.json({wallet,token,expiresAt:Date.now()+7*86400000},{headers:{'cache-control':'no-store'}});
  }catch(error){return NextResponse.json({error:'Wallet sign-in could not complete. Start again.'},{status:(error as {status?:number}).status??503});}
}

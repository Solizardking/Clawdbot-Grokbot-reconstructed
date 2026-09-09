import {NextRequest,NextResponse} from 'next/server';
import {authConfigured,siteOrigin} from '@/lib/config';
import {hash,opaque,serviceClient,mutationRef} from '@/lib/identity';
import {mobileSignInInput} from '@/lib/mobile-sign-in';
import {assertNativeRequest,nativeProofHash} from '@/lib/native-auth';
export async function POST(request:NextRequest){
  try{
    assertNativeRequest(request);if(!authConfigured())throw new Error('Not configured');
    const raw=await request.text();if(raw.length>1000)return NextResponse.json({error:'Request too large'},{status:413});
    const {clientProof}=JSON.parse(raw),browserHash=nativeProofHash(clientProof);
    const challengeId=opaque(),input=mobileSignInInput(siteOrigin(),hash(opaque()));
    await(await serviceClient()).mutation(mutationRef('mobileIdentity:prepare'),{challengeId,browserHash,rateKey:hash(process.env.AUTH_RATE_SALT+':native:'+ (request.headers.get('fly-client-ip')??'unknown')),input:JSON.stringify(input)});
    return NextResponse.json({challengeId,input},{headers:{'cache-control':'no-store'}});
  }catch(error){return NextResponse.json({error:'Wallet sign-in could not start. Try again.'},{status:(error as {status?:number}).status??503});}
}

import {NextRequest,NextResponse} from 'next/server';
import {hash,serviceClient,mutationRef,queryRef} from '@/lib/identity';
import {assertNativeRequest,nativeSessionToken} from '@/lib/native-auth';
export async function GET(request:NextRequest){
  try{
    assertNativeRequest(request);const token=nativeSessionToken(request);
    const session=await(await serviceClient()).query(queryRef('identity:session'),{tokenHash:hash(token)});
    if(!session)return NextResponse.json({error:'Sign in again'},{status:401});
    return NextResponse.json({wallet:session.wallet,expiresAt:session.expiresAt},{headers:{'cache-control':'no-store'}});
  }catch(error){return NextResponse.json({error:'Session unavailable'},{status:(error as {status?:number}).status??503});}
}
export async function DELETE(request:NextRequest){
  try{
    assertNativeRequest(request);const token=nativeSessionToken(request);
    await(await serviceClient()).mutation(mutationRef('identity:logout'),{tokenHash:hash(token)});
    return NextResponse.json({ok:true},{headers:{'cache-control':'no-store'}});
  }catch(error){return NextResponse.json({error:'Sign out unavailable. Retry before removing this device session.'},{status:(error as {status?:number}).status??503});}
}

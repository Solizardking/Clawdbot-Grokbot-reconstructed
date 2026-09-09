import {NextRequest,NextResponse} from 'next/server';
import {assertSameOrigin} from '@/lib/config';
import {challengeCookie,cookieOptions,hash,mutationRef,opaque,queryRef,serviceClient,sessionCookie} from '@/lib/identity';
import {verifyWalletMessage} from '@/lib/siws';
export async function POST(request:NextRequest){
  try{
    assertSameOrigin(request);const body=await request.text();if(body.length>2000)return NextResponse.json({error:'Request too large'},{status:413});
    const {challengeId,signature}=JSON.parse(body),browser=request.cookies.get(challengeCookie())?.value;
    if(typeof challengeId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(challengeId)||!browser)return NextResponse.json({error:'Start wallet login again'},{status:400});
    const client=await serviceClient(),browserHash=hash(browser);
    const challenge=await client.query(queryRef('identity:getChallenge'),{challengeId,browserHash}) as {wallet:string;message:string}|null;
    if(!challenge||!verifyWalletMessage(challenge.wallet,challenge.message,signature))return NextResponse.json({error:'Wallet signature is invalid or the login request expired'},{status:401});
    const token=opaque();await client.mutation(mutationRef('identity:finishLogin'),{challengeId,browserHash,tokenHash:hash(token)});
    const response=NextResponse.json({wallet:challenge.wallet},{headers:{'cache-control':'no-store'}});
    response.cookies.set(sessionCookie(),token,{...cookieOptions,maxAge:7*86400});response.cookies.set(challengeCookie(),'',{...cookieOptions,sameSite:'strict',maxAge:0});return response;
  }catch(error){return NextResponse.json({error:'Could not complete wallet login. Start again.'},{status:(error as {status?:number}).status??503});}
}

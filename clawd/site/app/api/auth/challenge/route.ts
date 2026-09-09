import {NextResponse} from 'next/server';
import {assertSameOrigin,authConfigured,siteOrigin} from '@/lib/config';
import {challengeCookie,cookieOptions,hash,mutationRef,opaque,serviceClient} from '@/lib/identity';
import {loginMessage,validWallet} from '@/lib/siws';
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    if(!authConfigured())return NextResponse.json({error:'Wallet signup is being configured. Please try again later.'},{status:503});
    const body=await request.text();if(body.length>1000)return NextResponse.json({error:'Request too large'},{status:413});
    const {wallet}=JSON.parse(body);if(!validWallet(wallet))return NextResponse.json({error:'Choose a valid Solana wallet'},{status:400});
    const challengeId=opaque(),browser=opaque(),message=loginMessage({origin:siteOrigin(),wallet,nonce:challengeId});
    const ip=request.headers.get('fly-client-ip')??(process.env.NODE_ENV==='production'?'unknown-production-client':'local');
    const client=await serviceClient();
    await client.mutation(mutationRef('identity:challenge'),{challengeId,wallet,message,browserHash:hash(browser),rateKey:hash(process.env.AUTH_RATE_SALT+':'+ip)});
    const response=NextResponse.json({challengeId,message},{headers:{'cache-control':'no-store'}});
    response.cookies.set(challengeCookie(),browser,{...cookieOptions,sameSite:'strict',maxAge:300});return response;
  }catch(error){const status=(error as {status?:number}).status??503;return NextResponse.json({error:status===403?'Cross-origin request rejected':'Wallet login is unavailable. Please try again shortly.'},{status});}
}

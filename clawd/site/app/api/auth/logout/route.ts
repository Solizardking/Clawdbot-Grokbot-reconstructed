import {NextRequest,NextResponse} from 'next/server';
import {assertSameOrigin} from '@/lib/config';
import {cookieOptions,hash,mutationRef,serviceClient,sessionCookie} from '@/lib/identity';
export async function POST(request:NextRequest){
  try{assertSameOrigin(request);const token=request.cookies.get(sessionCookie())?.value;
    if(token)await (await serviceClient()).mutation(mutationRef('identity:logout'),{tokenHash:hash(token)});
    const response=NextResponse.json({ok:true});response.cookies.set(sessionCookie(),'',{...cookieOptions,maxAge:0});return response;
  }catch(error){return NextResponse.json({error:'Sign out could not be completed. Try again.'},{status:(error as {status?:number}).status??503});}
}

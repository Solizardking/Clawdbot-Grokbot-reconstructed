import {NextRequest,NextResponse} from 'next/server';
import {cookieOptions,currentSession,hash,mutationRef,opaque,queryRef,serviceClient} from '@/lib/identity';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;if(!/^[a-z0-9]{10,64}$/.test(id))return NextResponse.json({error:'Release not found'},{status:404});
    const client=await serviceClient(),release=await client.query(queryRef('releases:getDownload'),{releaseId:id}) as {url:string}|null;
    if(!release)return NextResponse.json({error:'This release is not available for download'},{status:404});
    const url=new URL(release.url),allowed=(process.env.DOWNLOAD_ALLOWED_ORIGINS??'').split(',').map(s=>s.trim());
    if(url.protocol!=='https:'||url.username||url.password||!allowed.includes(url.origin))throw new Error('Unapproved download origin');
    const cookie=request.cookies.get('clawd_download')?.value,visitor=cookie&&/^[A-Za-z0-9_-]{43}$/.test(cookie)?cookie:opaque();
    const session=await currentSession();
    await client.mutation(mutationRef('releases:track'),{eventId:hash(visitor+':'+id+':'+Math.floor(Date.now()/86400000)),releaseId:id,...(session?{userId:session.userId}:{})});
    const response=NextResponse.redirect(url,302);response.headers.set('cache-control','no-store');response.cookies.set('clawd_download',visitor,{...cookieOptions,maxAge:86400});return response;
  }catch{return NextResponse.json({error:'The download could not be started. Please try again shortly.'},{status:503});}
}

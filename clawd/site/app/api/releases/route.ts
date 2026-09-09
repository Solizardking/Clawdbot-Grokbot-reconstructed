import {NextResponse} from 'next/server';
import {ConvexHttpClient} from 'convex/browser';
import {queryRef} from '@/lib/identity';
export async function GET(){
  if(!process.env.NEXT_PUBLIC_CONVEX_URL)return NextResponse.json({releases:[],status:'preparing'},{headers:{'cache-control':'no-store'}});
  try{const client=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);return NextResponse.json({releases:await client.query(queryRef('releases:list'),{}),status:'ready'},{headers:{'cache-control':'no-store'}});}
  catch{return NextResponse.json({error:'Release service temporarily unavailable'},{status:503});}
}

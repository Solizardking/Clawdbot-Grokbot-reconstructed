import {NextResponse} from 'next/server';
import {authConfigured} from '@/lib/config';
import {serviceClient,queryRef} from '@/lib/identity';
export async function GET(){
  try {
    if(!authConfigured())throw new Error('Authentication is not configured');
    const client=await serviceClient();
    await client.query(queryRef('identity:session'),{tokenHash:'0'.repeat(64)});
    return NextResponse.json({ready:true,accounts:'connected'},{headers:{'cache-control':'no-store'}});
  }catch{return NextResponse.json({ready:false,accounts:'unavailable'},{status:503,headers:{'cache-control':'no-store'}});}
}

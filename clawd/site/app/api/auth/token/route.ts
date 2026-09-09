import {NextResponse} from 'next/server';
import {currentSession,issueJwt} from '@/lib/identity';
export async function GET(){
  try{const session=await currentSession();return NextResponse.json(session?{wallet:session.wallet,token:await issueJwt('wallet:'+session.wallet,'wallet')}:{wallet:null,token:null},{headers:{'cache-control':'no-store'}});}
  catch{return NextResponse.json({error:'Account service unavailable'},{status:503,headers:{'cache-control':'no-store'}});}
}

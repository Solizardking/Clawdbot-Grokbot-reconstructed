import {NextResponse} from 'next/server';
import {walletClient,queryRef} from '@/lib/identity';
export async function GET(){
  try{const {client}=await walletClient();return NextResponse.json(await client.query(queryRef('identity:me'),{}),{headers:{'cache-control':'no-store'}});}
  catch(error){return NextResponse.json({error:'Sign in to view your account'},{status:(error as {status?:number}).status??503});}
}

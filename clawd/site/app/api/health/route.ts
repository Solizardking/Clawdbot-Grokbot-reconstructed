import {NextResponse} from 'next/server';
export async function GET(){return NextResponse.json({status:'ok',service:'clawd-site'},{headers:{'cache-control':'no-store'}});}

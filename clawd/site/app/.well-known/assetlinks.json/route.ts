import {NextResponse} from 'next/server';
import {androidAssetLinks} from '@/lib/android-association';
export function GET(){
  return NextResponse.json(androidAssetLinks(),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=3600'}});
}

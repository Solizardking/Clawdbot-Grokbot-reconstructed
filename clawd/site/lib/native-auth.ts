import {hash} from './identity';

export function assertNativeRequest(request:Request){
  // Native clients do not send browser origins or cookies. Browser requests
  // must continue using the existing CSRF-bound website login endpoints.
  if(request.headers.has('origin')||request.headers.has('cookie')||request.headers.get('x-clawd-client')!=='android-v1')
    throw Object.assign(new Error('Native client required'),{status:403});
}
export function nativeProofHash(value:unknown){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw Object.assign(new Error('Invalid client proof'),{status:400});
  return hash('clawd-native-v1:'+value);
}
export function nativeSessionToken(request:Request){
  const value=request.headers.get('authorization')??'';
  const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(value);
  if(!match)throw Object.assign(new Error('Sign in again'),{status:401});
  return match[1];
}

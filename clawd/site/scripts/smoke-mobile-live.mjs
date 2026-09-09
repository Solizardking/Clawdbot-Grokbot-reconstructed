import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createSignInMessage} from '@solana/wallet-standard-util';
const origin=process.argv[2]??'https://clawd-desktop-site-8bit.fly.dev';
assert.equal(new URL(origin).protocol,'https:');
const cookies=new Map();
async function request(path,body,headers={}){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  for(const cookie of response.headers.getSetCookie()){
    const [entry]=cookie.split(';'),at=entry.indexOf('=');cookies.set(entry.slice(0,at),entry.slice(at+1));
  }
  return {status:response.status,data:await response.json()};
}
assert.equal((await request('/api/auth/mobile/challenge',{}, {origin:'https://untrusted.example'})).status,403);
const challenge=await request('/api/auth/mobile/challenge',{});assert.equal(challenge.status,200);
const keys=nacl.sign.keyPair(),wallet=bs58.encode(keys.publicKey);
assert.equal(challenge.data.input.domain,new URL(origin).host);
const message=createSignInMessage({...challenge.data.input,address:wallet});
const proof={challengeId:challenge.data.challengeId,wallet,signedMessage:Buffer.from(message).toString('base64'),signature:Buffer.from(nacl.sign.detached(message,keys.secretKey)).toString('base64')};
assert.equal((await request('/api/auth/mobile/verify',{...proof,signature:Buffer.alloc(64).toString('base64')})).status,401);
const browser=[...cookies].find(([key])=>key.includes('mobile'));
assert.equal((await request('/api/auth/mobile/verify',proof,{cookie:''})).status,400);
assert.equal((await request('/api/auth/mobile/verify',proof)).status,200);
const account=await request('/api/account');assert.equal(account.status,200);assert.equal(account.data.wallet,wallet);
cookies.set(...browser);
assert.equal((await request('/api/auth/mobile/verify',proof)).status,401);
assert.equal((await request('/api/auth/logout',{})).status,200);
assert.equal((await request('/api/account')).status,401);
console.log(JSON.stringify({mobileSiws:true,signatureVerified:true,browserBound:true,replayDenied:true,crossOriginDenied:true,logout:true,testWallet:wallet,deviceWalletApprovalTested:false}));

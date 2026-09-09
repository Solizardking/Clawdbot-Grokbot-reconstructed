import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
const origin=process.argv[2]??'https://clawd-desktop-site-8bit.fly.dev';
const url=new URL(origin);
if(url.protocol!=='https:'&&url.hostname!=='localhost')throw new Error('Use HTTPS');
const cookies=new Map();
async function request(path,body,options={}){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,...(body===undefined?{}:{'content-type':'application/json'}),cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  for(const cookie of response.headers.getSetCookie()){
    const [entry]=cookie.split(';'),at=entry.indexOf('=');cookies.set(entry.slice(0,at),entry.slice(at+1));
  }
  const data=await response.json();return {status:response.status,data};
}
assert.equal((await request('/api/ready')).status,200,'Convex account readiness');
assert.equal((await request('/api/account')).status,401,'Anonymous account denied');
const keypair=nacl.sign.keyPair(),wallet=bs58.encode(keypair.publicKey);
assert.equal((await request('/api/auth/challenge',{wallet},{headers:{origin:'https://untrusted.example'}})).status,403,'Cross-origin login denied');
const challenge=await request('/api/auth/challenge',{wallet});
assert.equal(challenge.status,200,'Challenge creation');
assert.ok(challenge.data.message.includes(url.host)&&challenge.data.message.includes(wallet));
const bad=await request('/api/auth/verify',{challengeId:challenge.data.challengeId,signature:Buffer.alloc(64).toString('base64')});
assert.equal(bad.status,401,'Invalid signature denied');
const proof={challengeId:challenge.data.challengeId,signature:Buffer.from(nacl.sign.detached(new TextEncoder().encode(challenge.data.message),keypair.secretKey)).toString('base64')};
const browserCookie=[...cookies].find(([name])=>name.includes('login'));
assert.equal((await request('/api/auth/verify',proof)).status,200,'Signed login');
const account=await request('/api/account');assert.equal(account.status,200);assert.equal(account.data.wallet,wallet);assert.equal(account.data.subscription,null);
if(browserCookie)cookies.set(...browserCookie);
assert.notEqual((await request('/api/auth/verify',proof)).status,200,'Nonce replay denied');
const token=await request('/api/auth/token');assert.equal(token.data.wallet,wallet);assert.ok(token.data.token);
assert.equal((await request('/api/auth/logout',{})).status,200,'Logout');
assert.equal((await request('/api/account')).status,401,'Revoked session denied');
console.log(JSON.stringify({ready:true,walletSignature:true,accountIsolation:true,nonceReplayDenied:true,crossOriginDenied:true,logout:true,testWallet:wallet,note:'Ephemeral test wallet; no funds or transactions.'}));

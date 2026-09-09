import {afterEach,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import {createSignInMessage} from '@solana/wallet-standard-util';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import schema from '../convex/schema';
import {mobileSignInInput,verifyMobileSignIn} from '../lib/mobile-sign-in';
const modules=import.meta.glob('../convex/**/*.ts');
const mutation=(name:string)=>makeFunctionReference<'mutation'>(name);
const query=(name:string)=>makeFunctionReference<'query'>(name);
const keys=nacl.sign.keyPair(),wallet=bs58.encode(keys.publicKey);
const input=mobileSignInInput('https://clawd.example','a'.repeat(64));
const challenge={challengeId:'m'.repeat(43),browserHash:'a'.repeat(64),rateKey:'b'.repeat(64),input:JSON.stringify(input)};
const finish={challengeId:challenge.challengeId,browserHash:challenge.browserHash,wallet,tokenHash:'c'.repeat(64)};
afterEach(()=>vi.useRealTimers());

it('binds mobile SIWS proof to the exact signer, origin, nonce and login fields',()=>{
  const message=createSignInMessage({...input,domain:input.domain!,address:wallet});
  const signature=Buffer.from(nacl.sign.detached(message,keys.secretKey)).toString('base64');
  const encoded=Buffer.from(message).toString('base64');
  expect(verifyMobileSignIn(input,wallet,encoded,signature)).toBe(true);
  for(const changed of [{...input,domain:'attacker.example'},{...input,nonce:'b'.repeat(64)},{...input,uri:'https://attacker.example'},{...input,chainId:'solana:devnet'}])
    expect(verifyMobileSignIn(changed,wallet,encoded,signature)).toBe(false);
  expect(verifyMobileSignIn(input,bs58.encode(nacl.sign.keyPair().publicKey),encoded,signature)).toBe(false);
  const misleading=createSignInMessage({...input,domain:input.domain!,address:bs58.encode(nacl.sign.keyPair().publicKey)});
  expect(verifyMobileSignIn(input,wallet,Buffer.from(misleading).toString('base64'),Buffer.from(nacl.sign.detached(misleading,keys.secretKey)).toString('base64'))).toBe(false);
  expect(verifyMobileSignIn(input,wallet,'x'.repeat(6001),signature)).toBe(false);
});

it('restricts mobile challenge operations to the service, binds browsers and prevents replay',async()=>{
  const t=convexTest(schema,modules),s=t.withIdentity({subject:'service:clawd-site',role:'service'});
  await expect(t.mutation(mutation('mobileIdentity:prepare'),challenge)).rejects.toThrow('Unauthorized');
  await expect(t.withIdentity({subject:'wallet:'+wallet,role:'wallet'}).mutation(mutation('mobileIdentity:finish'),finish)).rejects.toThrow('Unauthorized');
  await s.mutation(mutation('mobileIdentity:prepare'),challenge);
  expect(await s.query(query('mobileIdentity:get'),{challengeId:finish.challengeId,browserHash:'d'.repeat(64)})).toBeNull();
  await expect(s.mutation(mutation('mobileIdentity:finish'),{...finish,browserHash:'d'.repeat(64)})).rejects.toThrow('expired or already used');
  await s.mutation(mutation('mobileIdentity:finish'),finish);
  expect(await s.query(query('mobileIdentity:get'),{challengeId:finish.challengeId,browserHash:finish.browserHash})).toBeNull();
  await expect(s.mutation(mutation('mobileIdentity:finish'),finish)).rejects.toThrow('expired or already used');
  expect((await s.query(query('identity:session'),{tokenHash:finish.tokenHash})).wallet).toBe(wallet);
});

it('expires mobile challenges and throttles preparation',async()=>{
  vi.useFakeTimers();
  const s=convexTest(schema,modules).withIdentity({subject:'service:clawd-site',role:'service'});
  await s.mutation(mutation('mobileIdentity:prepare'),challenge);
  vi.advanceTimersByTime(300001);
  expect(await s.query(query('mobileIdentity:get'),{challengeId:finish.challengeId,browserHash:finish.browserHash})).toBeNull();
  await expect(s.mutation(mutation('mobileIdentity:finish'),finish)).rejects.toThrow('expired or already used');
  for(let i=0;i<10;i++)await s.mutation(mutation('mobileIdentity:prepare'),{...challenge,challengeId:String(i).repeat(43)});
  await expect(s.mutation(mutation('mobileIdentity:prepare'),{...challenge,challengeId:'z'.repeat(43)})).rejects.toThrow('Rate limit');
});

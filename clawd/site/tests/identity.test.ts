import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import schema from '../convex/schema';
import {loginMessage,verifyWalletMessage} from '../lib/siws';
const modules=import.meta.glob('../convex/**/*.ts');
const mutation=(name:string)=>makeFunctionReference<'mutation'>(name);
const query=(name:string)=>makeFunctionReference<'query'>(name);
const service={subject:'service:clawd-site',role:'service'};
const wallet=bs58.encode(nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7)).publicKey);
const challenge={challengeId:'x'.repeat(43),wallet,message:'Sign in to Clawd',browserHash:'a'.repeat(64),rateKey:'b'.repeat(64)};
const finish={challengeId:challenge.challengeId,browserHash:challenge.browserHash,tokenHash:'c'.repeat(64)};
afterEach(()=>vi.useRealTimers());
describe('wallet authentication',()=>{
  it('verifies only the exact message and signing wallet',()=>{
    const keys=nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const message=loginMessage({origin:'https://clawd.example',wallet,nonce:challenge.challengeId});
    const signature=Buffer.from(nacl.sign.detached(new TextEncoder().encode(message),keys.secretKey)).toString('base64');
    expect(verifyWalletMessage(wallet,message,signature)).toBe(true);
    expect(verifyWalletMessage(wallet,message.replace('clawd.example','attacker.example'),signature)).toBe(false);
    expect(verifyWalletMessage(bs58.encode(nacl.sign.keyPair().publicKey),message,signature)).toBe(false);
  });
  it('rejects public or wallet callers of trusted service mutations',async()=>{
    const t=convexTest(schema,modules);
    await expect(t.mutation(mutation('identity:challenge'),challenge)).rejects.toThrow('Unauthorized');
    await expect(t.withIdentity({subject:'wallet:'+wallet,role:'wallet'}).mutation(mutation('identity:challenge'),challenge)).rejects.toThrow('Unauthorized');
  });
  it('binds a nonce to the browser, consumes it once and revokes sessions',async()=>{
    const t=convexTest(schema,modules).withIdentity(service);
    await t.mutation(mutation('identity:challenge'),challenge);
    await expect(t.mutation(mutation('identity:finishLogin'),{...finish,browserHash:'d'.repeat(64)})).rejects.toThrow('expired or already used');
    await t.mutation(mutation('identity:finishLogin'),finish);
    await expect(t.mutation(mutation('identity:finishLogin'),finish)).rejects.toThrow('expired or already used');
    expect((await t.query(query('identity:session'),{tokenHash:finish.tokenHash})).wallet).toBe(wallet);
    await t.mutation(mutation('identity:logout'),{tokenHash:finish.tokenHash});
    expect(await t.query(query('identity:session'),{tokenHash:finish.tokenHash})).toBeNull();
  });
  it('expires login challenges and sessions',async()=>{
    vi.useFakeTimers();
    const t=convexTest(schema,modules).withIdentity(service);
    await t.mutation(mutation('identity:challenge'),challenge);
    vi.advanceTimersByTime(300001);
    await expect(t.mutation(mutation('identity:finishLogin'),finish)).rejects.toThrow('expired or already used');
    await t.mutation(mutation('identity:challenge'),{...challenge,challengeId:'y'.repeat(43)});
    await t.mutation(mutation('identity:finishLogin'),{...finish,challengeId:'y'.repeat(43)});
    vi.advanceTimersByTime(7*86400000+1);
    expect(await t.query(query('identity:session'),{tokenHash:finish.tokenHash})).toBeNull();
  });
  it('isolates wallet account queries and enforces login rate limits',async()=>{
    const t=convexTest(schema,modules),s=t.withIdentity(service);
    await s.mutation(mutation('identity:challenge'),challenge);
    await s.mutation(mutation('identity:finishLogin'),finish);
    expect((await t.withIdentity({subject:'wallet:'+wallet,role:'wallet'}).query(query('identity:me'),{})).wallet).toBe(wallet);
    expect(await t.withIdentity({subject:'wallet:someone-else',role:'wallet'}).query(query('identity:me'),{})).toBeNull();
    for(let i=1;i<10;i++)await s.mutation(mutation('identity:challenge'),{...challenge,challengeId:String(i).repeat(43)});
    await expect(s.mutation(mutation('identity:challenge'),{...challenge,challengeId:'z'.repeat(43)})).rejects.toThrow('Rate limit');
  });
});

import {expect,it} from 'vitest';
import {assertNativeRequest,nativeProofHash,nativeSessionToken} from '../lib/native-auth';
import {hash} from '../lib/identity';
it('separates native proof from browser cookies and rejects ambient browser authentication',()=>{
  const headers={'x-clawd-client':'android-v1'};
  expect(()=>assertNativeRequest(new Request('https://clawd.example',{headers}))).not.toThrow();
  for(const extra of [{origin:'https://clawd.example'},{origin:'https://attacker.example'},{cookie:'clawd_session=secret'}] as Record<string,string>[])
    expect(()=>assertNativeRequest(new Request('https://clawd.example',{headers:{...headers,...extra}}))).toThrow();
  expect(()=>assertNativeRequest(new Request('https://clawd.example'))).toThrow();
  expect(nativeProofHash('a'.repeat(43))).not.toBe(hash('a'.repeat(43)));
  expect(()=>nativeProofHash('short')).toThrow();
});
it('requires an explicit well-formed bearer session',()=>{
  expect(nativeSessionToken(new Request('https://clawd.example',{headers:{authorization:'Bearer '+'x'.repeat(43)}}))).toBe('x'.repeat(43));
  for(const value of ['', 'Bearer short','Basic '+'x'.repeat(43)])expect(()=>nativeSessionToken(new Request('https://clawd.example',{headers:{authorization:value}}))).toThrow();
});

'use client';
import type {SolanaSignInInput} from '@solana/wallet-standard-features';
export const MOBILE_WALLET_NAME='Mobile Wallet Adapter';
export type MobileChallenge={challengeId:string;input:SolanaSignInInput};
let registration:Promise<void>|undefined,prepared:MobileChallenge|undefined,pending:Promise<MobileChallenge>|undefined;
export function initializeMobileWallet(){
  if(typeof window==='undefined')return Promise.resolve();
  return registration??=(async()=>{
    const mwa=await import('@solana-mobile/wallet-standard-mobile');
    mwa.registerMwa({appIdentity:{name:'Clawd',uri:window.location.origin,icon:'/clawd-icon.svg'},authorizationCache:mwa.createDefaultAuthorizationCache(),chains:['solana:mainnet'],chainSelector:mwa.createDefaultChainSelector(),onWalletNotFound:mwa.createDefaultWalletNotFoundHandler()});
  })();
}
// Prepare before the click: Android must receive signIn within the user's
// gesture, without an intervening server fetch or a second wallet connection.
export function prepareMobileChallenge(){
  if(prepared&&Date.parse(prepared.input.expirationTime??'')>Date.now()+30000)return Promise.resolve(prepared);
  return pending??=(async()=>{
    const response=await fetch('/api/auth/mobile/challenge',{method:'POST',headers:{'content-type':'application/json'},body:'{}',cache:'no-store'});
    const data=await response.json();if(!response.ok)throw new Error(data.error??'Mobile login unavailable');
    prepared=data;return data as MobileChallenge;
  })().finally(()=>{pending=undefined;});
}
export function invalidateMobileChallenge(){prepared=undefined;}

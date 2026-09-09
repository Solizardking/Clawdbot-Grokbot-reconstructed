import type {SolanaSignInInput} from '@solana/wallet-standard-features';
import {verifySignIn} from '@solana/wallet-standard-util';
import bs58 from 'bs58';
import {validWallet} from './siws';
export function mobileSignInInput(origin:string,nonce:string,now=new Date()):SolanaSignInInput{
  return {domain:new URL(origin).host,uri:origin,version:'1',chainId:'solana:mainnet',statement:'Sign in to Clawd. This does not authorize transactions or token transfers.',nonce,issuedAt:now.toISOString(),expirationTime:new Date(now.getTime()+300000).toISOString()};
}
export function verifyMobileSignIn(input:SolanaSignInInput,wallet:unknown,signedMessage:unknown,signature:unknown){
  if(!validWallet(wallet)||typeof signedMessage!=='string'||signedMessage.length>6000||typeof signature!=='string'||signature.length>100)return false;
  try{return verifySignIn({...input,address:wallet},{account:{address:wallet,publicKey:bs58.decode(wallet),chains:['solana:mainnet'],features:['solana:signIn']},signedMessage:Buffer.from(signedMessage,'base64'),signature:Buffer.from(signature,'base64'),signatureType:'ed25519'});}catch{return false;}
}

import bs58 from 'bs58';
import nacl from 'tweetnacl';
export function validWallet(wallet:unknown):wallet is string{
  if(typeof wallet!=='string'||wallet.length<32||wallet.length>44)return false;
  try{return bs58.decode(wallet).length===32;}catch{return false;}
}
export function loginMessage({origin,wallet,nonce,now=new Date()}:{origin:string;wallet:string;nonce:string;now?:Date}){
  if(!validWallet(wallet)||!/^[A-Za-z0-9_-]{43}$/.test(nonce))throw new Error('Invalid login request');
  const url=new URL(origin);
  return `${url.host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to Clawd. This message does not authorize transactions or token transfers.\n\nURI: ${url.origin}\nVersion: 1\nChain ID: solana:mainnet\nNonce: ${nonce}\nIssued At: ${now.toISOString()}\nExpiration Time: ${new Date(now.getTime()+300000).toISOString()}`;
}
export function verifyWalletMessage(wallet:string,message:string,signature:unknown){
  if(!validWallet(wallet)||typeof signature!=='string'||signature.length>100)return false;
  try{const bytes=Buffer.from(signature,'base64');return bytes.length===64&&nacl.sign.detached.verify(new TextEncoder().encode(message),bytes,bs58.decode(wallet));}catch{return false;}
}

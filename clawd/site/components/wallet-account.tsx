'use client';
import {useEffect,useState} from 'react';
import {getWallets} from '@wallet-standard/app';
import type {Wallet,WalletAccount} from '@wallet-standard/base';
import type {StandardConnectFeature} from '@wallet-standard/features';
import type {SolanaSignMessageFeature,SolanaSignInFeature} from '@solana/wallet-standard-features';
import {initializeMobileWallet,invalidateMobileChallenge,MOBILE_WALLET_NAME,prepareMobileChallenge,type MobileChallenge} from '@/lib/mobile-wallet';
import {ArrowUpRight,Wallet as WalletIcon,X} from 'lucide-react';
type LoginWallet=Wallet&{features:StandardConnectFeature&SolanaSignMessageFeature};
type Account={wallet:string;createdAt:number;subscription:{planId:string;expiresAt:number;active:boolean}|null};
async function json(path:string,body?:unknown){const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store'});const value=await response.json();if(!response.ok)throw new Error(value.error??'Request failed');return value;}
export function WalletAccount({enabled}:{enabled:boolean}){
  const [open,setOpen]=useState(false),[wallets,setWallets]=useState<LoginWallet[]>([]),[account,setAccount]=useState<Account|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [mobileChallenge,setMobileChallenge]=useState<MobileChallenge|null>(null);
  const mobileWallet=wallets.find(wallet=>wallet.name===MOBILE_WALLET_NAME&&'solana:signIn' in wallet.features);
  useEffect(()=>{
    const registry=getWallets(),refresh=()=>setWallets(registry.get().filter(w=>'standard:connect' in w.features&&'solana:signMessage' in w.features) as LoginWallet[]);
    refresh();const unregister=registry.on('register',refresh),unregisterRemoved=registry.on('unregister',refresh);
    void initializeMobileWallet().then(refresh).catch(()=>setError('Mobile wallet support could not load. Please reload.'));
    const sync=()=>void json('/api/auth/token').then(result=>result.wallet?json('/api/account').then(setAccount):setAccount(null)).catch(()=>{});
    window.addEventListener('clawd-account-changed',sync);
    if(enabled)void json('/api/auth/token').then(result=>{if(result.wallet)return json('/api/account').then(setAccount);}).catch(()=>{});
    return()=>{unregister();unregisterRemoved();window.removeEventListener('clawd-account-changed',sync);};
  },[enabled]);
  useEffect(()=>{
    if(!mobileWallet||!enabled||account)return;
    let disposed=false;
    const prepare=()=>void prepareMobileChallenge().then(value=>{if(!disposed)setMobileChallenge(value);}).catch(()=>{if(!disposed)setError('Mobile sign-in preparation failed. Reload to retry.');});
    prepare();const timer=setInterval(prepare,60000);return()=>{disposed=true;clearInterval(timer);};
  },[mobileWallet,enabled,account]);
  async function mobileLogin(wallet:LoginWallet){
    if(!mobileChallenge||Date.parse(mobileChallenge.input.expirationTime??'')<=Date.now()){setError('Sign-in is refreshing. Try again shortly.');void prepareMobileChallenge().then(setMobileChallenge).catch(()=>setError('Mobile login is unavailable. Try again shortly.'));return;}
    setBusy(true);setError('');
    try{
      const feature=(wallet.features as typeof wallet.features&SolanaSignInFeature)['solana:signIn'];
      const [signed]=await feature.signIn(mobileChallenge.input);
      if(!signed)throw new Error('The wallet did not return a signed login');
      const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
      await json('/api/auth/mobile/verify',{challengeId:mobileChallenge.challengeId,wallet:signed.account.address,signedMessage:encode(signed.signedMessage),signature:encode(signed.signature)});
      setAccount(await json('/api/account'));window.dispatchEvent(new Event('clawd-account-changed'));
    }catch(e){setError(e instanceof Error?e.message:'Mobile wallet login failed');}
    finally{invalidateMobileChallenge();setMobileChallenge(null);setBusy(false);void prepareMobileChallenge().then(setMobileChallenge).catch(()=>{});}
  }
  async function login(wallet:LoginWallet){
    setBusy(true);setError('');
    try{
      const connected=await wallet.features['standard:connect'].connect();
      const selected:WalletAccount|undefined=connected.accounts.find(a=>a.chains.some(c=>c.startsWith('solana:'))&&a.features.includes('solana:signMessage'));
      if(!selected)throw new Error('This wallet has no Solana account with message signing');
      const challenge=await json('/api/auth/challenge',{wallet:selected.address});
      const [signed]=await wallet.features['solana:signMessage'].signMessage({account:selected,message:new TextEncoder().encode(challenge.message)});
      if(!signed||new TextDecoder().decode(signed.signedMessage)!==challenge.message)throw new Error('The wallet signed a different message. Try again.');
      const signature=btoa(String.fromCharCode(...signed.signature));
      await json('/api/auth/verify',{challengeId:challenge.challengeId,signature});setAccount(await json('/api/account'));window.dispatchEvent(new Event('clawd-account-changed'));
    }catch(e){setError(e instanceof Error?e.message:'Wallet login failed');}finally{setBusy(false);}
  }
  return <>
    <button className="button wallet-button" disabled={busy} onClick={()=>{setOpen(true);if(!account&&enabled&&mobileWallet&&mobileChallenge)void mobileLogin(mobileWallet);}}><WalletIcon size={15}/>{account?account.wallet.slice(0,4)+'…'+account.wallet.slice(-4):mobileWallet?'Use Installed Wallet':'Connect wallet'}<ArrowUpRight size={14}/></button>
    {open&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)setOpen(false);}}><section role="dialog" aria-modal="true" aria-labelledby="wallet-title" className="account-modal">
      <button className="close-button" aria-label="Close account" disabled={busy} onClick={()=>setOpen(false)}><X size={18}/></button>
      <span className="eyebrow">YOUR CLAWD ACCOUNT</span><h2 id="wallet-title">{account?'Welcome to your desk.':'Your wallet is your login.'}</h2>
      {account?<><p className="wallet-address">{account.wallet}</p><div className="account-status"><span>Subscription</span><strong>{account.subscription?.active?'Active until '+new Date(account.subscription.expiresAt).toLocaleDateString():'No active subscription'}</strong></div><p>Downloads and your plan are connected to this wallet. Your private key stays in your wallet.</p><a className="button primary" href="/account">Open account <ArrowUpRight size={16}/></a><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await json('/api/auth/logout',{});invalidateMobileChallenge();setMobileChallenge(null);setAccount(null);window.dispatchEvent(new Event('clawd-account-changed'));}catch(e){setError(String(e));}finally{setBusy(false);}}}>Sign out</button></>:<>
        <p>Sign a one-time message to create or access your account. Login never requests a transaction.</p>
        {!enabled?<p role="status" className="notice">Wallet signup is being prepared for launch.</p>:wallets.length?wallets.map(wallet=><button className="wallet-choice" key={wallet.name} disabled={busy||(wallet===mobileWallet&&!mobileChallenge)} onClick={()=>void (wallet===mobileWallet?mobileLogin(wallet):login(wallet))}><WalletIcon size={18}/>{wallet===mobileWallet?'Use Installed Wallet':wallet.name}<ArrowUpRight size={16}/></button>):<p role="status" className="notice">On Solana Mobile, open this page in Android Chrome to use Seed Vault Wallet, Phantom, or Solflare. On desktop or iPhone, open it in a wallet-enabled browser.</p>}
      </>}
      {busy&&<p role="status">Waiting for your wallet…</p>}{error&&<p role="alert" className="error">{error}</p>}
    </section></div>}
  </>;
}

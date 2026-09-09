import {WalletAccount} from '@/components/wallet-account';
import {authConfigured} from '@/lib/config';
import {walletClient,queryRef} from '@/lib/identity';
export const dynamic='force-dynamic';
export default async function Account(){
  let account:{wallet:string;subscription:{planId:string;expiresAt:number;active:boolean}|null}|null=null,error='';
  if(authConfigured())try{const {client}=await walletClient();account=await client.query(queryRef('identity:me'),{});}catch{error='Sign in to view your account. If you already signed in, the account service may be temporarily unavailable.';}
  return <main className="prose-page"><a className="eyebrow" href="/">← CLAWD DESKTOP</a><h1>Your account.</h1><WalletAccount enabled={authConfigured()}/>{account?<><p className="wallet-address">{account.wallet}</p><h2>Subscription</h2><p>{account.subscription?.active?`${account.subscription.planId} · access until ${new Date(account.subscription.expiresAt).toLocaleString()}`:'You do not have an active subscription.'}</p><p>Checkout will become available after launch pricing and payment settlement are configured.</p><a className="button primary" href="/#download">Get Clawd</a></>:<p role="status">{error||'Wallet accounts are being prepared for launch.'}</p>}</main>;
}

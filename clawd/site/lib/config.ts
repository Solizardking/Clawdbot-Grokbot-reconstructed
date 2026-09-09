export function siteOrigin(){
  const value=process.env.SITE_ORIGIN;
  if(!value)throw new Error('Clawd website is not configured');
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||process.env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Invalid site origin');
  return url.origin;
}
export function authConfigured(){return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.SITE_ORIGIN&&process.env.AUTH_PRIVATE_KEY_PEM&&process.env.AUTH_RATE_SALT);}
export function assertSameOrigin(request:Request){if(request.headers.get('origin')!==siteOrigin())throw Object.assign(new Error('Cross-origin request rejected'),{status:403});}

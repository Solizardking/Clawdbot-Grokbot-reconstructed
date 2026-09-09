import {generateKeyPairSync,randomBytes,createPublicKey} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve('.cache/clawd-site-credentials');
await mkdir(dir,{recursive:true,mode:0o700});
const keyPath=resolve(dir,'auth-private.pem');
let pem;
try {pem=await readFile(keyPath,'utf8');}
catch(error) {
  if(error.code!=='ENOENT')throw error;
  pem=generateKeyPairSync('rsa',{modulusLength:3072}).privateKey.export({type:'pkcs8',format:'pem'});
  await writeFile(keyPath,pem,{mode:0o600,flag:'wx'});
}
const jwk={...createPublicKey(pem).export({format:'jwk'}),kid:'clawd-site-1',alg:'RS256',use:'sig'};
const origin='https://clawd-desktop-site-8bit.fly.dev';
await writeFile(resolve(dir,'convex-auth.env'),`SITE_ORIGIN=${origin}\nSITE_JWKS_JSON=${JSON.stringify({keys:[jwk]})}\n`,{mode:0o600});
const runtime=resolve(dir,'site-runtime.env');
try {await readFile(runtime);}
catch(error) {
  if(error.code!=='ENOENT')throw error;
  await writeFile(runtime,`SITE_ORIGIN=${origin}\nNEXT_PUBLIC_CONVEX_URL=https://hushed-ocelot-930.convex.cloud\nCONVEX_SITE_URL=https://hushed-ocelot-930.convex.site\nAUTH_KEY_ID=clawd-site-1\nAUTH_PRIVATE_KEY_PEM=${pem.trim().replaceAll('\n','\\n')}\nAUTH_RATE_SALT=${randomBytes(32).toString('hex')}\n`,{mode:0o600,flag:'wx'});
}
console.log('Prepared private website runtime configuration and public Convex verification key.');

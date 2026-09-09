import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
const destination=resolve('.cache/clawd-site-credentials/convex.env');
if(!process.stdin.isTTY)throw new Error('Use an interactive terminal for hidden credential entry');
process.stdout.write('Convex deploy key (hidden): ');process.stdin.setRawMode(true);process.stdin.resume();
let input='';
process.stdin.on('data',async chunk=>{
  for(const character of String(chunk)){
    if(character==='\u0003'){process.stdin.setRawMode(false);process.exit(1);}
    if(character==='\r'||character==='\n'){
      process.stdin.setRawMode(false);process.stdin.pause();
      if(!/^prod:merry-elephant-282\|[A-Za-z0-9+/=_-]+$/.test(input))throw new Error('Unexpected deployment key format');
      await mkdir(resolve('.cache/clawd-site-credentials'),{recursive:true,mode:0o700});
      await writeFile(destination,`CONVEX_DEPLOY_KEY=${input}\nNEXT_PUBLIC_CONVEX_URL=https://merry-elephant-282.convex.cloud\nCONVEX_SITE_URL=https://merry-elephant-282.convex.site\n`,{mode:0o600});await chmod(destination,0o600);
      input='';process.stdout.write('\nSaved private Convex access.\n');process.exit(0);
    }else if(character==='\u007f')input=input.slice(0,-1);else if(character>=' ')input+=character;
  }
});

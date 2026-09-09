import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
if(!process.stdin.isTTY)throw new Error('Use hidden interactive entry');
const dir=resolve('.cache/clawd-site-credentials');
process.stdout.write('Convex management token (hidden): ');
process.stdin.setRawMode(true);process.stdin.resume();let token='';
process.stdin.on('data',async chunk=>{
  for(const char of String(chunk)){
    if(char==='\u0003'){process.stdin.setRawMode(false);process.exit(1);}
    if(char==='\r'||char==='\n'){
      process.stdin.setRawMode(false);process.stdin.pause();
      if(!/^[A-Za-z0-9+/=_-]{30,}$/.test(token))throw new Error('Unexpected token format');
      await mkdir(dir,{recursive:true,mode:0o700});
      await writeFile(resolve(dir,'management.env'),`CONVEX_TOKEN=${token}\n`,{mode:0o600});
      token='';process.stdout.write('\nSaved private management credential.\n');process.exit(0);
    }else if(char==='\u007f')token=token.slice(0,-1);else if(char>=' ')token+=char;
  }
});

import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseHostedAccessFile} from './lib/hosted-access-file.mjs';
const access=parseHostedAccessFile(await readFile(resolve('.cache/gateway-owner/client.env'),'utf8'));
const directory=resolve('.cache/hosted-computer-check');await mkdir(directory,{recursive:true,mode:0o700});
const stateFile=resolve(directory,'state.json');
let state={};try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const save=()=>writeFile(stateFile,JSON.stringify(state,null,2),{mode:0o600});
async function call(path,body){
  const response=await fetch(access.url+path,{method:'POST',headers:{authorization:'Bearer '+access.token,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok){await response.body?.cancel();throw new Error(`${path}: HTTP ${response.status}`);}
  return response.json();
}
const mode=process.argv[2]??'--check';
if(mode==='--start'){
  if(state.startedAt)throw new Error('A check already exists; inspect --check before starting another');
  state.startedAt=new Date().toISOString();await save();
  try{
    const desktop=await call('/e2b/request',{action:'status'});
    state.desktop={id:desktop.sandboxId,createdByCheck:Boolean(desktop.note),expiresAt:desktop.expiresAt};await save();
    if(state.desktop.createdByCheck){
      const result=await call('/e2b/request',{action:'run_command',args:{command:"printf 'CLAWD_E2B_READY\\n'; uname -s; xdg-open https://example.com >/tmp/clawd-browser-check.log 2>&1 &"}});
      state.desktop.commandPassed=result.stdout?.includes('CLAWD_E2B_READY')&&result.exitCode===0;await save();
    }
    console.log(JSON.stringify({e2bConnected:true,newDesktop:state.desktop.createdByCheck,commandPassed:state.desktop.commandPassed??null}));
  }catch(error){state.desktopError=error.message;await save();console.log(JSON.stringify({e2bError:error.message}));}
  try{
    const run=await call('/browseruse/request',{method:'POST',path:'/runs',body:{task:'Open https://example.com and report its page heading and URL. Do not visit other sites, sign in, submit forms, or download anything. Finish after reporting the heading.'}});
    state.browser={id:run.id,status:run.status};await save();console.log(JSON.stringify({browserRunCreated:true,status:run.status}));
  }catch(error){state.browserError=error.message;await save();console.log(JSON.stringify({browserError:error.message}));}
}else if(mode==='--check'){
  if(state.desktop&&!state.desktop.screenshotPath&&Date.now()<state.desktop.expiresAt){
    const shot=await call('/e2b/request',{action:'screenshot'});
    const image=Buffer.from(shot.image_base64,'base64');if(image.readUInt32BE(0)!==0x89504e47)throw new Error('Invalid PNG screenshot');
    state.desktop.screenshotPath=resolve(directory,'desktop.png');await writeFile(state.desktop.screenshotPath,image,{mode:0o600});await save();
  }
  if(state.browser&&!['completed','failed','cancelled','stopped','error'].includes(state.browser.status)){
    const run=await call('/browseruse/request',{method:'GET',path:'/runs/'+state.browser.id});
    state.browser.status=run.status;state.browser.output=run.output??run.result??null;await save();
  }
  console.log(JSON.stringify({e2b:state.desktop?{commandPassed:state.desktop.commandPassed,screenshotPath:state.desktop.screenshotPath,stopped:state.desktop.stopped}:state.desktopError,browser:state.browser?{status:state.browser.status,output:state.browser.output}:state.browserError}));
}else if(mode==='--stop'){
  if(state.desktop?.createdByCheck&&!state.desktop.stopped){await call('/e2b/request',{action:'stop'});state.desktop.stopped=true;await save();}
  if(state.browser&&!['completed','failed','cancelled','stopped','error'].includes(state.browser.status)){await call('/browseruse/request',{method:'POST',path:'/runs/'+state.browser.id+'/cancel',body:{}});state.browser.status='cancelled';await save();}
  console.log('Stopped only resources created by this check.');
}else throw new Error('Use --start, --check or --stop');

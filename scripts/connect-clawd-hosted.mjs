import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseHostedAccessFile } from './lib/hosted-access-file.mjs';

const [clientFile, selectedModel, provider = 'openrouter', configFile] = process.argv.slice(2);
if (!clientFile) throw new Error('Usage: connect-clawd-hosted.mjs CLIENT_ENV');
if (!['openrouter','novita','xai','nvidia'].includes(provider)) throw new Error('Unsupported hosted provider');
const access = parseHostedAccessFile(await readFile(clientFile,'utf8'));
const model = selectedModel ?? access.model;
const base = access.url + `/${provider}/v1`;
const catalog = await fetch(base+'/models',{headers:{authorization:`Bearer ${access.token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
if (!catalog.ok) throw new Error(`Hosted catalog unavailable (HTTP ${catalog.status})`);
const models = (await catalog.json()).data;
if (!Array.isArray(models) || !models.some(row=>row.id===model)) throw new Error('The selected model is not in the hosted chat catalog');
let patch={openaiCompat:{url:base,key:access.token}};
const instanceId=provider==='openrouter'?'openaiCompat':`hosted-${provider}`;
if(provider!=='openrouter') {
  const current=await fetch('http://127.0.0.1:8799/api/instances',{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!current.ok) throw new Error('Cannot preserve the existing Clawd engine fleet');
  const instances=(await current.json()).instances;
  if(!configFile) throw new Error('Additional engines require the installed Clawd workspace config path');
  const original=await readFile(configFile,'utf8');
  const config=JSON.parse(original);
  if(config.openaiCompat?.key!==access.token || config.openaiCompat?.url!==access.url+'/openrouter/v1') throw new Error('Connect the same hosted OpenRouter account first');
  if(!config.instances || !Object.keys(config.instances).length) config.instances=Object.fromEntries(instances.map(instance=>[instance.instanceId,{driver:instance.driverKind}]));
  // This engine inherits the existing user token from openaiCompat; no extra credential copy.
  config.instances[instanceId]={...config.instances[instanceId],driver:'openai-compat',displayName:`Fly ${provider}`,config:{url:base}};
  await writeFile(configFile+'.before-hosted-'+provider,original,{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await writeFile(configFile+'.hosted.tmp',JSON.stringify(config,null,2),{mode:0o600});
  await rename(configFile+'.hosted.tmp',configFile);
  // The public config API deliberately excludes engine definitions. Reload from
  // the documented config file by resaving the unchanged provider URL.
  patch={openaiCompat:{url:config.openaiCompat.url}};
}
// Use the installed app's own merge/reload API. Its config writer uses mode 0600.
// Only the revocable user token is saved locally; provider keys stay on Fly.
const saved = await fetch('http://127.0.0.1:8799/api/config',{
  method:'PATCH',headers:{'content-type':'application/json'},redirect:'error',
  body:JSON.stringify(patch),signal:AbortSignal.timeout(60000),
});
if (!saved.ok) throw new Error(`Clawd Bot configuration failed (HTTP ${saved.status})`);
const response=await fetch('http://127.0.0.1:8799/api/instances',{redirect:'error',signal:AbortSignal.timeout(30000)});
if (!response.ok) throw new Error(`Clawd Bot provider verification failed (HTTP ${response.status})`);
const instances=(await response.json()).instances;
const engine=instances.find(instance=>instance.instanceId===instanceId);
if (!engine || !engine.models?.options?.some(row=>row.id===model)) throw new Error('Clawd Bot did not load the hosted model');
console.log(JSON.stringify({connected:true,gateway:access.url,model,engine:engine.instanceId??engine.id}));

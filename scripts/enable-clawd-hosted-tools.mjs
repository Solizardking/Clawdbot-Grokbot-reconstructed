import {readFile,writeFile,rename} from 'node:fs/promises';
import {parseHostedAccessFile} from './lib/hosted-access-file.mjs';
const [clientFile,configFile]=process.argv.slice(2);
if(!clientFile||!configFile)throw new Error('Usage: enable-clawd-hosted-tools.mjs CLIENT_ENV CLAWD_CONFIG');
const access=parseHostedAccessFile(await readFile(clientFile,'utf8'));
const original=await readFile(configFile,'utf8'),config=JSON.parse(original);
if(config.openaiCompat?.url!==access.url+'/openrouter/v1'||config.openaiCompat?.key!==access.token)throw new Error('Clawd is not connected to this hosted account');
const engines=[],chatOnlyEngines=[];
for(const [id,engine] of Object.entries(config.instances??{})) {
  if(engine.driver!=='openai-compat')continue;
  const url=engine.config?.url??config.openaiCompat.url;
  if(!['openrouter','novita','xai','nvidia'].some(provider=>url===access.url+`/${provider}/v1`))continue;
  // This dedicated Novita deployment rejects automatic tool choice. Keep its
  // verified chat path available until a server-side tool parser is configured.
  const enabled=url!==access.url+'/novita/v1';
  engine.config={...engine.config,hostedTavily:enabled};
  (enabled?engines:chatOnlyEngines).push(id);
}
if(!engines.length&&!chatOnlyEngines.length)throw new Error('No configured hosted engines');
await writeFile(configFile+'.before-hosted-tools',original,{mode:0o600,flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
await writeFile(configFile+'.hosted.tmp',JSON.stringify(config,null,2),{mode:0o600});
await rename(configFile+'.hosted.tmp',configFile);
// Reload engine configuration through the existing local settings endpoint.
const reloaded=await fetch('http://127.0.0.1:8799/api/config',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({openaiCompat:{url:config.openaiCompat.url}})});
if(!reloaded.ok)throw new Error('Saved configuration, but Clawd could not reload it');
console.log(JSON.stringify({hostedWebToolsEnabledFor:engines,chatOnlyEngines}));

import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve('.cache/clawd-site-credentials');
const env=await readFile(resolve(dir,'management.env'),'utf8');
const token=env.match(/^CONVEX_TOKEN=(.+)$/m)?.[1];
if(!token)throw new Error('Private management credential is missing');
async function api(path,body,prefix='/v1'){
  const response=await fetch('https://api.convex.dev'+prefix+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  if(!response.ok){
    const error=await response.json().catch(()=>({}));
    const message=String(error.message??error.error??error.code??'Access denied').replaceAll(token,'[redacted]').slice(0,400);
    throw new Error(`Convex management ${response.status} at ${path}: ${message}`);
  }
  return response.json();
}
const details=await api('/teams',undefined,'/api');
await writeFile(resolve(dir,'management-metadata.json'),JSON.stringify(details,null,2),{mode:0o600});
console.log(JSON.stringify(details.map(({id,slug,name})=>({id,slug,name}))));
if(process.argv.includes('--create')){
  if(details.length!==1||details[0].id!==533416)throw new Error('Unexpected team scope');
  const metadataPath=resolve(dir,'dedicated-deployment.json');
  let project;
  try{project=JSON.parse(await readFile(metadataPath,'utf8'));}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    project=await api('/teams/533416/create_project',{projectName:'Clawd Desktop',deploymentType:'prod'});
    await writeFile(metadataPath,JSON.stringify(project,null,2),{mode:0o600,flag:'wx'});
  }
  if(!project.deploymentName||!project.deploymentUrl)throw new Error('Project exists but deployment provisioning needs inspection');
  const keyFile=resolve(dir,'dedicated-convex.env');
  try{await readFile(keyFile);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    const {deployKey}=await api(`/deployments/${project.deploymentName}/create_deploy_key`,{name:'Clawd desktop website deployment'});
    if(typeof deployKey!=='string'||!deployKey.startsWith('prod:'+project.deploymentName+'|'))throw new Error('Unexpected deploy key format');
    await writeFile(keyFile,`CONVEX_DEPLOY_KEY=${deployKey}\nNEXT_PUBLIC_CONVEX_URL=${project.deploymentUrl}\nCONVEX_SITE_URL=${project.deploymentUrl.replace('.convex.cloud','.convex.site')}\n`,{mode:0o600,flag:'wx'});
  }
  console.log(JSON.stringify({projectId:project.id,slug:project.slug,deployment:project.deploymentName,url:project.deploymentUrl}));
}

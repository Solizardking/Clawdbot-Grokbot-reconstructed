import type { AppConfig as Config } from "./config.ts";
import { HOSTED_DESKTOP_ACTIONS, type HostedDesktopAction, type HostedDesktopStatus } from "../shared/hosted-desktop.ts";
const fail=(message:string,status=409):never=>{throw Object.assign(new Error(message),{status});};
export function hostedDesktopAccess(cfg:Config) {
  let url:URL;
  try {url=new URL(cfg.openaiCompat?.url??"");}catch{return null;}
  const token=cfg.openaiCompat?.key;
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!/^\/(openrouter|novita|xai|nvidia)\/v1\/?$/.test(url.pathname)||!token)return null;
  return {origin:url.origin,token};
}
export async function hostedDesktopRequest(cfg:Config,botId:string,action:HostedDesktopAction,args:Record<string,unknown>={},fetchImpl:typeof fetch=fetch):Promise<any> {
  const access=hostedDesktopAccess(cfg);
  if(!access)fail("Connect your hosted Clawd account to use E2B");
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(botId)||!HOSTED_DESKTOP_ACTIONS.includes(action))fail("Invalid hosted desktop request",400);
  let response:Response;
  try {response=await fetchImpl(access!.origin+"/e2b/request",{method:"POST",redirect:"error",signal:AbortSignal.timeout(45000),headers:{authorization:`Bearer ${access!.token}`,"content-type":"application/json"},body:JSON.stringify({contextId:botId,action,args})});}
  catch {return fail("Hosted desktop connection failed. Check your connection and retry.",502);}
  if(!response.ok){await response.body?.cancel();return fail(response.status===401?"Your hosted Clawd account needs to reconnect":response.status===403?"E2B is not enabled for this Clawd account":response.status===409?"The hosted desktop is unavailable or in use by another bot. Check its status.":response.status===429?"Hosted desktop request limit reached. Wait before retrying.":"The hosted desktop provider is unavailable",[401,403,409,429].includes(response.status)?response.status:502);}
  const reader=response.body?.getReader();if(!reader)fail("Empty hosted desktop response",502);
  let size=0;const chunks:Uint8Array[]=[];
  try {for(;;){const {done,value}=await reader!.read();if(done)break;size+=value.length;if(size>8_200_000){await reader!.cancel();fail("Hosted desktop response is too large",502);}chunks.push(value);}}
  catch {return fail("Hosted desktop response could not be read",502);}
  let data:any;try{data=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return fail("Invalid hosted desktop response",502);}
  if(action==="inspect") {
    if(!["stopped","ready","pending","in_use"].includes(data?.state)||!Array.isArray(data.resolution)||data.resolution[0]!==1280||data.resolution[1]!==800)fail("Invalid hosted desktop status",502);
    return {state:data.state,resolution:[1280,800],...(Number.isSafeInteger(data.expiresAt)?{expiresAt:data.expiresAt}:{})} satisfies HostedDesktopStatus;
  }
  if(action==="screenshot") {
    if(data?.format!=="png"||typeof data.image_base64!=="string"||data.image_base64.length>8_000_000||!/^iVBORw0KGgo[A-Za-z0-9+/=]*$/.test(data.image_base64))fail("Invalid hosted desktop screenshot",502);
    return {png:data.image_base64,format:"png"};
  }
  if(action==="status"){
    if(!Number.isSafeInteger(data?.expiresAt))fail("Invalid hosted desktop expiry",502);
    return {state:"ready",resolution:[1280,800],expiresAt:data.expiresAt};
  }
  if(action==="stop"){
    if(data?.stopped!==true)fail("Hosted desktop did not confirm it stopped",502);
    return {stopped:true};
  }
  if(action==="run_command")return {exitCode:Number.isInteger(data.exitCode)?data.exitCode:null,stdout:String(data.stdout??"").slice(0,65536),stderr:String(data.stderr??"").slice(0,65536)};
  return {ok:true};
}

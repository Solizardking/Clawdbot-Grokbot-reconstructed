import readline from "node:readline";
import {HOSTED_DESKTOP_TOOLS} from "../shared/hosted-desktop.ts";
const endpoint=process.env.OMB_E2B_URL??"",token=process.env.OMB_COMMS_TOKEN??"";
const send=(id:unknown,result:unknown)=>process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,result})+"\n");
let observed=false;
async function handle(message:any) {
  const {id,method,params={}}=message;
  if(id===undefined)return;
  if(method==="initialize")return send(id,{protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"clawd-hosted-desktop",version:"1.0.0"}});
  if(method==="ping")return send(id,{});
  if(method==="tools/list")return send(id,{tools:HOSTED_DESKTOP_TOOLS.map(({action,...tool})=>tool)});
  if(method!=="tools/call")return send(id,{isError:true,content:[{type:"text",text:"Unsupported method"}]});
  const tool=HOSTED_DESKTOP_TOOLS.find(tool=>tool.name===params.name);
  try {
    if(!tool)throw new Error("Unknown hosted desktop tool");
    const target=new URL(endpoint);
    if(target.protocol!=="http:"||target.hostname!=="127.0.0.1"||target.pathname!=="/api/internal/hosted-desktop"||target.username||target.password||target.hash||!token)throw new Error("Invalid local desktop endpoint");
    if(tool.action!=="screenshot"&&!observed)throw new Error("Inspect the desktop with e2b_screenshot before acting");
    const response=await fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({action:tool.action,args:params.arguments??{}}),redirect:"error",signal:AbortSignal.timeout(60000)});
    const result=await response.json() as {error?:string;result?:unknown;png?:string};
    if(!response.ok)throw new Error(result.error??"Hosted desktop action failed");
    observed=Boolean(result.png);
    send(id,{content:[{type:"text",text:JSON.stringify(result.result??{ok:true})},...(result.png?[{type:"image",mimeType:"image/png",data:result.png}]:[])]});
  }catch(error){observed=false;send(id,{isError:true,content:[{type:"text",text:error instanceof Error?error.message:"Hosted desktop request failed"}]});}
}
let sequence=Promise.resolve();
const input=readline.createInterface({input:process.stdin,terminal:false});
input.on("line",line=>{try{const message=JSON.parse(line);sequence=sequence.then(()=>handle(message)).then(()=>{}).catch(()=>{});}catch{}});
input.on("close",()=>void sequence.finally(()=>process.exit(0)));

import {spawnSync} from 'node:child_process';
const program=`
const result={};
async function rpc(name,url){
  try {const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getLatestBlockhash',params:[{commitment:'confirmed'}]}),signal:AbortSignal.timeout(15000)});const b=await r.json();result[name]={http:r.status,ok:r.ok&&typeof b.result?.value?.blockhash==='string'};}
  catch{result[name]={ok:false};}
}
await rpc('solanaTrackerRpc',process.env.SOLANA_TRACKER_RPC_URL);
await rpc('solanaTrackerSecureRpc',process.env.SOLANA_TRACKER_SECURE_RPC);
try {const r=await fetch('https://integrate.api.nvidia.com/v1/models',{headers:{authorization:'Bearer '+process.env.NVIDIA_API_KEY},signal:AbortSignal.timeout(20000)});const b=await r.json();result.nvidia={http:r.status,ok:r.ok&&Array.isArray(b.data),models:Array.isArray(b.data)?b.data.length:0};}catch{result.nvidia={ok:false};}
result.solanaTrackerWebSocket=await new Promise(resolve=>{let socket;const timer=setTimeout(()=>{socket?.close();resolve({ok:false,reason:'timeout'});},15000);try{socket=new WebSocket(process.env.SOLANA_TRACKER_WSS_URL);socket.addEventListener('open',()=>socket.send(JSON.stringify({jsonrpc:'2.0',id:2,method:'slotSubscribe',params:[]})));socket.addEventListener('message',e=>{try{const value=JSON.parse(String(e.data));if(value.id===2){clearTimeout(timer);socket.close();resolve({ok:typeof value.result==='number',errorCode:value.error?.code,errorMessage:value.error?.message?.slice(0,160)});}}catch{}});socket.addEventListener('error',()=>{clearTimeout(timer);resolve({ok:false,reason:'connection error'});});socket.addEventListener('close',e=>{clearTimeout(timer);resolve({ok:false,reason:'connection closed',code:e.code,detail:String(e.reason).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[redacted]').replace(/https?:[^\\s]+/g,'[endpoint]').slice(0,180)});});}catch{clearTimeout(timer);resolve({ok:false,reason:'client setup error'});}});
console.log(JSON.stringify(result));
`;
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const result=spawnSync('fly',['ssh','console','--app','grok-provider-gateway-8bit','--command','node --input-type=module -e '+quote(program)],{encoding:'utf8',timeout:90000});
if(result.status!==0){console.error('Remote infrastructure probe failed. No credentials printed.');process.exitCode=1;}
else console.log(result.stdout.trim());

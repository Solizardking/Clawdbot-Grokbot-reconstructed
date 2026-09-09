import {it,expect} from "vitest";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {once} from "node:events";
import readline from "node:readline";

it("returns real MCP images, requires observation and resets it when the user takes control",async()=>{
  let calls=0,held=false;
  const server=createServer(async(req,res)=>{
    expect(req.headers.authorization).toBe("Bearer private-loopback-capability");
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString());calls++;
    if(held){res.writeHead(409,{"content-type":"application/json"});res.end(JSON.stringify({error:"The user is driving"}));return;}
    if(body.action==="click")expect(body.args).toEqual({x:25,y:30});
    res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({png:"iVBORw0KGgo=",result:{ok:true}}));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();if(!address||typeof address==="string")throw new Error("Missing fixture port");
  const child=spawn(process.env.CLAWD_PROXY_RUNTIME??process.execPath,[process.env.CLAWD_PROXY_SCRIPT??new URL("./hosted-desktop-proxy.ts",import.meta.url).pathname],{env:{...process.env,ELECTRON_RUN_AS_NODE:"1",OMB_E2B_URL:`http://127.0.0.1:${address.port}/api/internal/hosted-desktop?botId=bot-a`,OMB_COMMS_TOKEN:"private-loopback-capability"},stdio:["pipe","pipe","pipe"]});
  const pending=new Map<number,(value:any)=>void>();let id=0;
  const lines=readline.createInterface({input:child.stdout});lines.on("line",line=>{const reply=JSON.parse(line);pending.get(reply.id)?.(reply.result);pending.delete(reply.id);});
  const send=(method:string,params:unknown={})=>new Promise<any>((resolve,reject)=>{
    const requestId=++id,timer=setTimeout(()=>reject(new Error("MCP fixture timeout")),5000);
    pending.set(requestId,result=>{clearTimeout(timer);resolve(result);});child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:requestId,method,params})+"\n");
  });
  try {
    expect((await send("initialize")).serverInfo.name).toBe("clawd-hosted-desktop");
    expect((await send("tools/list")).tools.some((tool:any)=>tool.name==="e2b_screenshot")).toBe(true);
    expect((await send("tools/call",{name:"e2b_click",arguments:{x:25,y:30}})).isError).toBe(true);expect(calls).toBe(0);
    const shot=await send("tools/call",{name:"e2b_screenshot"});expect(shot.content).toContainEqual({type:"image",mimeType:"image/png",data:"iVBORw0KGgo="});
    expect((await send("tools/call",{name:"e2b_click",arguments:{x:25,y:30}})).isError).toBeUndefined();
    held=true;expect((await send("tools/call",{name:"e2b_screenshot"})).isError).toBe(true);
    const before=calls;expect((await send("tools/call",{name:"e2b_click",arguments:{x:25,y:30}})).isError).toBe(true);expect(calls).toBe(before);
  }finally{child.kill();lines.close();server.closeAllConnections();server.close();}
});

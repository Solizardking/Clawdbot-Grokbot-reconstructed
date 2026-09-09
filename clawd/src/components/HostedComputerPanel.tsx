import {useEffect,useRef,useState,type MouseEvent} from "react";
import {Hand,Loader2,Maximize2,Monitor,RefreshCw,X} from "lucide-react";
import {useStore,type Bot} from "@/state/store";
import {usePageVisible} from "@/lib/page-visible";
import {desktopPoint} from "@/lib/hosted-desktop";
import {CloudBackendPicker} from "./CloudBackendPicker";
import type {HostedDesktopAction,HostedDesktopStatus} from "../../shared/hosted-desktop.ts";

async function request(path:string,body?:unknown):Promise<any> {
  const response=await fetch(path,{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(50000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error??"Hosted desktop request failed");
  return result;
}
const button="rounded-lg border border-hairline/40 px-3 py-2 text-[13px] text-ink hover:bg-control disabled:cursor-not-allowed disabled:opacity-40";
export function HostedComputerPanel({bot}:{bot:Bot}) {
  const {state,dispatch}=useStore();
  const visible=usePageVisible();
  const [status,setStatus]=useState<HostedDesktopStatus|null>(null);
  const [frame,setFrame]=useState<string|null>(null);
  const [capturedAt,setCapturedAt]=useState<number|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [pending,setPending]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [text,setText]=useState("");
  const [key,setKey]=useState("ENTER");
  const [mouse,setMouse]=useState("left");
  const busy=useRef(false),alive=useRef(true);
  const dialog=useRef<HTMLDialogElement>(null);
  const base=`/api/bots/${bot.id}/hosted-computer`;
  const control=state.computerControl[bot.id]??{held:false,helpReason:null};
  const instance=state.instances.find(item=>item.instanceId===bot.modelSelection.instanceId);
  const agentSupported=instance?.capabilities?.computerMcp===true&&instance.driverKind!=="boxAgent";
  const ready=status?.state==="ready";
  const operation=async(work:()=>Promise<void>)=>{
    if(busy.current)return;
    busy.current=true;setPending(true);setError(null);
    try{await work();}catch(error){if(alive.current)setError(error instanceof Error?error.message:"Desktop unavailable");}
    finally{busy.current=false;if(alive.current)setPending(false);}
  };
  const capture=async()=>{
    const image=await request(base,{action:"screenshot"});
    if(alive.current){setFrame(`data:image/png;base64,${image.png}`);setCapturedAt(Date.now());}
  };
  const refresh=()=>operation(async()=>{
    const current=await request(base) as HostedDesktopStatus;
    if(!alive.current)return;
    setStatus(current);
    if(current.state==="ready")await capture();else {setFrame(null);setCapturedAt(null);}
  });
  const setControl=async(action:"take"|"release")=>{
    const value=await request(`/api/bots/${bot.id}/computer/control`,{action});
    dispatch({type:"computerControl",botId:bot.id,held:value.held===true,helpReason:typeof value.helpReason==="string"?value.helpReason:null});
  };
  useEffect(()=>{
    alive.current=true;
    void request(`/api/bots/${bot.id}/computer/control`).then(value=>{if(alive.current)dispatch({type:"computerControl",botId:bot.id,held:value.held===true,helpReason:value.helpReason??null});}).catch(()=>{});
    return()=>{alive.current=false;};
  },[bot.id,dispatch]);
  useEffect(()=>{
    if(!visible)return;
    void refresh();const timer=setInterval(()=>void refresh(),30000);
    return()=>clearInterval(timer);
  },[bot.id,visible]);
  useEffect(()=>{
    if(!expanded)return;
    const element=dialog.current;
    element?.showModal();
    return()=>element?.close();
  },[expanded]);
  const action=(action:HostedDesktopAction,args:Record<string,unknown>={})=>operation(async()=>{
    await request(base,{action,args});
    if(action==="stop"){
      await setControl("release");setStatus({state:"stopped",resolution:[1280,800]});setFrame(null);setExpanded(false);return;
    }
    if(action==="status")setStatus(await request(base));
    await capture();
  });
  const click=(event:MouseEvent<HTMLButtonElement>)=>{
    if(!control.held||!ready||pending||event.detail===0)return;
    const rect=event.currentTarget.getBoundingClientRect();
    const point=desktopPoint(event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height);
    if(point)void action("click",{...point,button:mouse});
  };
  const preview=(large=false)=><button type="button" onClick={click} disabled={!control.held||pending||!ready} aria-label="Click the hosted desktop" className={`${large?"min-h-0 flex-1":"aspect-[16/10] w-full"} flex items-center justify-center overflow-hidden rounded-lg bg-black disabled:cursor-default`}>
    {frame?<img src={frame} alt={`${bot.name}'s hosted Linux desktop`} className="h-full w-full object-contain" draggable={false}/>:<span className="flex items-center gap-2 p-6 text-[13px] text-ink-secondary"><Monitor size={18}/>{status?.state==="in_use"?"Desktop in use by another bot":status?.state==="pending"?"Creation pending; wait for the session to resolve":pending?"Checking desktop…":"Start a desktop to see its screen"}</span>}
  </button>;
  const controls=<>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={!ready||pending} onClick={()=>void operation(()=>setControl(control.held?"release":"take"))}><Hand size={14} className="mr-1.5 inline"/>{control.held?"Hand back to bot":"Take control"}</button>
      <button className={button} disabled={!ready||pending} onClick={()=>void operation(capture)}><RefreshCw size={14} className="mr-1.5 inline"/>Refresh screen</button>
    </div>
    {control.held&&ready&&<div className="space-y-2">
      <p className="text-[12px] text-ink-secondary">You are driving. Agent computer actions are paused.</p>
      <form className="flex gap-2" onSubmit={event=>{event.preventDefault();if(text&&!pending)void operation(async()=>{await request(base,{action:"type",args:{text}});setText("");await capture();});}}>
        <input aria-label="Text to type on hosted desktop" value={text} onChange={event=>setText(event.target.value)} maxLength={16384} autoComplete="off" className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink" placeholder="Type on the desktop"/>
        <button className={button} disabled={pending||!text}>Type</button>
      </form>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Desktop key" value={key} onChange={event=>setKey(event.target.value)} className={button}>{["ENTER","TAB","ESC","BACKSPACE","CTRL+L","CTRL+A","CTRL+C","CTRL+V","UP","DOWN","LEFT","RIGHT"].map(key=><option key={key}>{key}</option>)}</select>
        <button className={button} disabled={pending} onClick={()=>void action("key",{keys:key})}>Press key</button>
        <select aria-label="Mouse button" value={mouse} onChange={event=>setMouse(event.target.value)} className={button}><option value="left">Left click</option><option value="right">Right click</option></select>
        <button className={button} disabled={pending} onClick={()=>void action("scroll",{direction:"up",amount:3})}>Scroll up</button>
        <button className={button} disabled={pending} onClick={()=>void action("scroll",{direction:"down",amount:3})}>Scroll down</button>
      </div>
    </div>}
  </>;
  return <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-hairline/40 bg-panel max-[1100px]:fixed max-[1100px]:right-0 max-[1100px]:top-0 max-[1100px]:z-40 max-[1100px]:max-w-full max-[1100px]:shadow-2xl">
    <div className="flex items-center justify-between px-5 py-3"><span className="text-[15px] font-semibold text-ink">Hosted computer</span><button aria-label="Close computer panel" className={button} onClick={()=>dispatch({type:"toggleComputer",open:false})}><X size={16}/></button></div>
    <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5">
      <div className="flex items-center justify-between text-[13px] text-ink-secondary"><span>{bot.name} · E2B</span>{pending&&<Loader2 size={14} className="animate-spin"/>}</div>
      {preview()}
      {capturedAt&&<p className="text-[11px] text-ink-secondary">Snapshot {new Date(capturedAt).toLocaleTimeString()} · refreshes every 30 seconds</p>}
      {error&&<p role="alert" className="text-[13px] text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {status?.state==="stopped"&&<button className={button} disabled={pending||bot.busy||bot.computer==="off"} onClick={()=>void action("status")}>Start 15-minute desktop</button>}
        {ready&&<><button className={button} disabled={pending} onClick={()=>setExpanded(true)}><Maximize2 size={14} className="mr-1.5 inline"/>Expand</button><button className={button} disabled={pending||bot.busy} onClick={()=>void action("stop")}>Stop desktop</button></>}
        <button className={button} disabled={pending} onClick={()=>void refresh()}>Check status</button>
      </div>
      {status?.expiresAt&&<p className="text-[12px] text-ink-secondary">Expires {new Date(status.expiresAt).toLocaleTimeString()}. Files and browser sessions are removed when this desktop stops or expires.</p>}
      {!expanded&&controls}
      {!agentSupported&&<p className="text-[13px] text-ink-secondary">You can drive this desktop. For agent control, choose Claude or an ACP engine that supports computer tools.</p>}
      <p className="text-[12px] text-ink-secondary">One active hosted desktop per Clawd account. Opening this panel checks status only. Closing it leaves the desktop running until you stop it or it expires.</p>
      <div className="flex gap-2"><button className={button} disabled={pending||bot.busy||ready||status?.state==="pending"} onClick={()=>dispatch({type:"updateBot",botId:bot.id,patch:{computer:bot.computer==="off"?"cloud":"off"}})}>{bot.computer==="off"?"Enable Cloud":"Turn computer off"}</button></div>
      <fieldset disabled={pending||bot.busy||ready||status?.state==="pending"}><CloudBackendPicker value="e2b" vpsSupported={agentSupported} onChange={cloudBackend=>dispatch({type:"updateBot",botId:bot.id,patch:{cloudBackend}})}/></fieldset>
      {(ready||status?.state==="pending")&&<p className="text-[12px] text-ink-secondary">Stop this desktop before changing its destination.</p>}
    </div>
    {expanded&&<dialog ref={dialog} onCancel={()=>setExpanded(false)} aria-label="Hosted desktop viewer" className="fixed inset-4 m-0 h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-h-none max-w-none flex-col gap-3 rounded-xl border border-hairline bg-panel p-4 shadow-2xl open:flex backdrop:bg-black/60"><div className="flex items-center justify-between"><span className="font-semibold text-ink">{bot.name}'s hosted desktop</span><button className={button} aria-label="Close expanded desktop" onClick={()=>setExpanded(false)}><X size={18}/></button></div>{preview(true)}{error&&<p role="alert" className="text-red-400">{error}</p>}{controls}</dialog>}
  </aside>;
}

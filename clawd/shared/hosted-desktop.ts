export type HostedDesktopAction = "inspect" | "status" | "stop" | "screenshot" | "click" | "type" | "key" | "scroll" | "drag" | "run_command";
export type HostedDesktopState = "stopped" | "ready" | "pending" | "in_use";
export interface HostedDesktopStatus { state: HostedDesktopState; expiresAt?: number; resolution: [number, number] }
export const HOSTED_DESKTOP_ACTIONS: HostedDesktopAction[] = ["inspect", "status", "stop", "screenshot", "click", "type", "key", "scroll", "drag", "run_command"];
export const HOSTED_DESKTOP_MUTATIONS = new Set<HostedDesktopAction>(["click", "type", "key", "scroll", "drag", "run_command"]);
const point={type:"integer",minimum:0};
const tool=(name:string,action:HostedDesktopAction,description:string,properties:Record<string,unknown>,required:string[]=Object.keys(properties))=>({name,action,description,inputSchema:{type:"object",properties,required,additionalProperties:false}});
export const HOSTED_DESKTOP_TOOLS = [
  tool("e2b_screenshot","screenshot","Inspect this bot's hosted Linux desktop before acting. Coordinates refer to this 1280 by 800 image.",{}),
  tool("e2b_click","click","Click the observed desktop. Returns the resulting screenshot.",{x:{...point,maximum:1279},y:{...point,maximum:799},button:{type:"string",enum:["left","right","middle"]},count:{type:"integer",enum:[1,2]}},["x","y"]),
  tool("e2b_type","type","Type text into the focused field. Never enter passwords or one-time codes; ask the user to take control.",{text:{type:"string",minLength:1,maxLength:16384}}),
  tool("e2b_key","key","Press a key or shortcut, such as ENTER or CTRL+L.",{keys:{type:"string",minLength:1,maxLength:256}}),
  tool("e2b_scroll","scroll","Scroll the observed desktop and return the resulting screenshot.",{direction:{type:"string",enum:["up","down"]},amount:{type:"integer",minimum:1,maximum:15}},[]),
  tool("e2b_drag","drag","Drag between two points in the observed desktop.",{from_x:{...point,maximum:1279},from_y:{...point,maximum:799},to_x:{...point,maximum:1279},to_y:{...point,maximum:799}}),
  tool("e2b_command","run_command","Run a Linux shell command inside this disposable hosted desktop, never on the user's Mac. Files expire with the session.",{command:{type:"string",minLength:1,maxLength:16384}}),
];

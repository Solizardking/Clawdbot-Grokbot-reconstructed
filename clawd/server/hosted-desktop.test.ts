import {describe,it,expect,vi} from "vitest";
import {hostedDesktopAccess,hostedDesktopRequest} from "./hosted-desktop.ts";
const cfg={openaiCompat:{url:"https://gateway.example/openrouter/v1",key:"account-access-token"}};
describe("hosted desktop boundary",()=>{
  it("routes only through the configured gateway and binds requests to the bot",async()=>{
    const fetcher=vi.fn(async(url,init)=>{
      expect(url).toBe("https://gateway.example/e2b/request");
      expect(init.redirect).toBe("error");expect(init.headers.authorization).toBe("Bearer account-access-token");
      expect(JSON.parse(init.body)).toEqual({contextId:"bot-a",action:"inspect",args:{}});
      return Response.json({state:"in_use",expiresAt:1000,resolution:[1280,800],sandboxId:"private-other-context",apiKey:"not-for-client"});
    });
    expect(await hostedDesktopRequest(cfg,"bot-a","inspect",{},fetcher)).toEqual({state:"in_use",expiresAt:1000,resolution:[1280,800]});
  });
  it("rejects missing access, unsafe URLs and invalid bot identifiers before forwarding",async()=>{
    for(const url of ["http://gateway.example/openrouter/v1","https://name:pass@gateway.example/openrouter/v1","https://gateway.example/other","https://gateway.example/nvidia/v1?key=x"])
      expect(hostedDesktopAccess({openaiCompat:{url,key:"access"}})).toBeNull();
    const fetcher=vi.fn();
    await expect(hostedDesktopRequest({},"bot-a","inspect",{},fetcher)).rejects.toThrow("Connect your hosted");
    await expect(hostedDesktopRequest(cfg,"bot/a","inspect",{},fetcher)).rejects.toThrow("Invalid");expect(fetcher).not.toHaveBeenCalled();
  });
  it("projects screenshots and reports sanitized provider failures",async()=>{
    const png="iVBORw0KGgo=";
    expect(await hostedDesktopRequest(cfg,"bot-a","screenshot",{},async()=>Response.json({format:"png",image_base64:png,secret:"private"}))).toEqual({png,format:"png"});
    await expect(hostedDesktopRequest(cfg,"bot-a","screenshot",{},async()=>Response.json({error:"secret diagnostic"},{status:503}))).rejects.toThrow("provider is unavailable");
    await expect(hostedDesktopRequest(cfg,"bot-a","screenshot",{},async()=>Response.json({format:"png",image_base64:"<html>"}))).rejects.toThrow("Invalid hosted desktop screenshot");
    await expect(hostedDesktopRequest(cfg,"bot-a","stop",{},async()=>Response.json({stopped:false}))).rejects.toThrow("did not confirm");
  });
});

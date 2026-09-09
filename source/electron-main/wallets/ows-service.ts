import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import type { WalletInfo } from "@open-wallet-standard/core";

export type OwsRequest = { id: string; name: string; status: "awaiting_password" | "creating" | "created" | "cancelled"; wallet?: WalletInfo };
export function walletName(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,79}$/.test(value.trim())) throw new Error("Use a wallet name of 1–80 letters, numbers, spaces, hyphens or underscores.");
  return value.trim();
}
/** Native KDF work stays off Electron's event loop. Passwords travel only in
 * local worker messages, never process arguments, environment or tool results. */
export function runOwsWorker(operation: "list" | "create", args: { name?: string; password?: string; vaultPath?: string } = {}): Promise<WalletInfo[] | WalletInfo> {
  return new Promise((resolve, reject) => {
    const modulePath = require.resolve("@open-wallet-standard/core");
    const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      parentPort.once('message',args=>{try{const ows=require(workerData.modulePath);
        if(workerData.operation==='create' && ows.listWallets(args.vaultPath).some(w=>w.name===args.name)) throw Error('exists');
        const result=workerData.operation==='list'?ows.listWallets(args.vaultPath):ows.createWallet(args.name,args.password,12,args.vaultPath);
        args.password=undefined; parentPort.postMessage({ok:true,result});
      }catch(e){parentPort.postMessage({ok:false,error:e.message==='exists'?'A wallet with this name already exists.':'OWS could not complete the local vault operation.'});}});`, { eval: true, workerData: { modulePath, operation } });
    worker.once("message", message => { if (message.ok) resolve(message.result); else reject(new Error(message.error)); });
    worker.once("error", () => reject(new Error("The OWS wallet worker could not start.")));
    worker.once("exit", code => { if (code !== 0) reject(new Error("The OWS wallet worker stopped unexpectedly.")); });
    worker.postMessage(args);
  });
}

export function publicOwsWallet(wallet: WalletInfo): { id: string; name: string; createdAt: string; accounts: Array<{ chainId: string; address: string }> } {
  return {
    id: wallet.id,
    name: wallet.name,
    createdAt: wallet.createdAt,
    accounts: (wallet.accounts ?? []).map(account => ({ chainId: account.chainId, address: account.address })),
  };
}

function vaultArgs(vaultPath: string | undefined): { vaultPath?: string } {
  return vaultPath === undefined ? {} : { vaultPath };
}

export function createOwsService(options: { run?: typeof runOwsWorker; vaultPath?: string } = {}) {
  const run = options.run ?? runOwsWorker;
  const requests = new Map<string, OwsRequest>();
  let creating = false;
  return {
    getOwsRequests: () => ({ requests: [...requests.values()].map(row => ({ id: row.id, name: row.name, status: row.status, ...(row.wallet == null ? {} : { wallet: publicOwsWallet(row.wallet) }) })) }),
    listOwsWallets: async () => ({ wallets: ((await run("list", vaultArgs(options.vaultPath))) as WalletInfo[]).map(publicOwsWallet) }),
    requestOwsWallet(raw: { name?: unknown }) {
      const name = walletName(raw?.name);
      const existing = [...requests.values()].find(row => row.name === name && ["awaiting_password", "creating"].includes(row.status));
      if (existing) return { ...existing };
      if (requests.size >= 50) throw new Error("Too many wallet requests. Restart the app after completing pending requests.");
      const row: OwsRequest = { id: randomUUID(), name, status: "awaiting_password" };
      requests.set(row.id, row);
      return { ...row, instruction: "Open the Trading panel and enter your wallet password in its masked field. Never send the password to the bot." };
    },
    cancelOwsRequest(raw: { id?: unknown }) {
      const row = typeof raw?.id === "string" ? requests.get(raw.id) : undefined;
      if (!row || row.status !== "awaiting_password") throw new Error("No pending wallet request.");
      row.status = "cancelled"; return { ...row };
    },
    async createOwsWallet(raw: { name?: unknown; password?: unknown; requestId?: unknown }) {
      const name = walletName(raw?.name);
      if (typeof raw.password !== "string" || raw.password.length < 8 || raw.password.length > 1024) throw new Error("Use a wallet password between 8 and 1024 characters.");
      if (creating) throw new Error("Another wallet is being created. Wait for it to finish.");
      const row = typeof raw.requestId === "string" ? requests.get(raw.requestId) : undefined;
      if (raw.requestId != null && (!row || row.name !== name || row.status !== "awaiting_password")) throw new Error("This wallet request is no longer pending.");
      creating = true; if (row) row.status = "creating";
      try {
        const wallet = await run("create", { name, password: raw.password, ...vaultArgs(options.vaultPath) }) as WalletInfo;
        const publicWallet = publicOwsWallet(wallet);
        if (row) { row.status = "created"; row.wallet = wallet; }
        return publicWallet;
      } catch (error) { if (row) row.status = "awaiting_password"; throw error; }
      finally { creating = false; raw.password = undefined; }
    },
  };
}

export const OWS_ROUTED_TOOLS = [
 {name:"ows_wallet_create",toolName:"ows_wallet_create",providerIdentifier:"ows",description:"Request a locally encrypted OWS trading wallet. Opens a pending request in the desktop Trading panel; user enters a password there. This does not create the wallet until the user completes the form. Never ask for a password in chat.",inputSchema:{type:"object",properties:{name:{type:"string"}},required:["name"],additionalProperties:false}},
 {name:"ows_wallet_list",toolName:"ows_wallet_list",providerIdentifier:"ows",description:"List local OWS wallets and public chain addresses. Does not reveal keys or unlock funds.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"ows_wallet_requests",toolName:"ows_wallet_requests",providerIdentifier:"ows",description:"Check whether a requested OWS wallet is awaiting its user's password or has been created. Returns only status and public addresses.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
] as const;
export function isOwsTool(name: unknown): name is string { return typeof name === "string" && OWS_ROUTED_TOOLS.some(t => t.name === name); }
export function executeOwsTool(service: ReturnType<typeof createOwsService>, name: string, args: unknown) {
  if (name === "ows_wallet_list") return service.listOwsWallets();
  if (name === "ows_wallet_requests") return service.getOwsRequests();
  if (name === "ows_wallet_create") return service.requestOwsWallet((args ?? {}) as {name?: unknown});
  throw new Error("Unknown OWS tool.");
}

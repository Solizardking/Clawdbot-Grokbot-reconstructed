import type { JsonValue } from "@bufbuild/protobuf";
import { hostedProviderConfig, withHostedProviderConfig } from "../../../shared/hosted-provider.js";
import { BIRDEYE_ROUTED_TOOLS, createDefaultBirdeyePort, executeBirdeyeRoutedTool } from "../../../node-agent-coordinator/birdeye-tools.js";
import { BROWSER_USE_ROUTED_TOOLS, executeBrowserUseRoutedTool } from "../../../node-agent-coordinator/browser-use-tools.js";
import { E2B_ROUTED_TOOLS, executeE2bRoutedTool } from "../../../node-agent-coordinator/e2b-tools.js";
import { GROK_ROUTED_TOOLS, executeGrokMediaRoutedTool } from "../../../node-agent-coordinator/grok-media-tools.js";
import { McpResult, McpSuccess, McpToolResultContentItem, McpImageContent } from "../../../packages/proto/generated/agent/v1/mcp_exec_pb.js";
import { generatedMcpResultFactory as resultFactory } from "../../../shared/node/mcp/mcp-result-factory.js";
import { toJsonArgs } from "../../../shared/node/mcp/mcp-validation.js";

export const HOSTED_SERVICE_PROVIDER = "hosted-services";
type Tool = { name: string; toolName: string; providerIdentifier: string; description?: string; inputSchema?: JsonValue };
type Discovery = {
  getTools(ctx?: unknown): Promise<Tool[]>;
  getToolsForTurnStart(ctx?: unknown): Promise<Tool[]>;
  executeTool(ctx: unknown, args: any, auditIdentity: unknown): Promise<any>;
  resolveProviderTransport(id: string): Promise<"http" | "stdio" | "unknown">;
};
const GROUPS = [
  { service: "birdeye", tools: BIRDEYE_ROUTED_TOOLS, execute: (name: string, args: unknown) => executeBirdeyeRoutedTool(createDefaultBirdeyePort(), name, args) },
  { service: "browseruse", tools: BROWSER_USE_ROUTED_TOOLS, execute: executeBrowserUseRoutedTool },
  { service: "e2b", tools: E2B_ROUTED_TOOLS, execute: executeE2bRoutedTool },
  { service: "media", tools: GROK_ROUTED_TOOLS, execute: executeGrokMediaRoutedTool },
];
const STATUS: Tool = { name: "hosted_services_status", toolName: "hosted_services_status", providerIdentifier: HOSTED_SERVICE_PROVIDER,
  description: "List this user's configured hosted service grants and remaining daily request allowance. Configuration does not prove upstream account readiness. Never returns provider keys.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false } };
const HELIUS: Tool = { name: "helius_read", toolName: "helius_read", providerIdentifier: HOSTED_SERVICE_PROVIDER,
  description: "Read Solana RPC or DAS data through the connected Helius gateway. Supports read methods such as getBalance, getAssetsByOwner, getAsset and getTokenSupply. Cannot sign or submit transactions.",
  inputSchema: { type: "object", properties: { method: { type: "string" }, params: { type: ["array", "object"] } }, required: ["method"], additionalProperties: false } };
const asRecord = (value: unknown): Record<string, any> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;

/** Adds hosted services to the normal MCP path, retaining its review and result handling. */
export function withHostedServiceTools<T extends Discovery>(base: T, options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: () => number; disabledTools?: () => readonly string[]; onExecuted?: (name: string) => void } = {}) {
  const env = options.env ?? process.env, fetchImpl = options.fetchImpl ?? globalThis.fetch, now = options.now ?? Date.now;
  let cached: { url: string; token: string; expires: number; account: Record<string, any> } | undefined;
  const accountFor = async (config: {url: string; token: string}) => {
    if (cached?.url === config.url && cached.token === config.token && cached.expires > now()) return cached.account;
    const response = await fetchImpl(config.url + "/v1/account", { headers: { authorization: `Bearer ${config.token}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Hosted service discovery failed (HTTP ${response.status}).`);
    const account = asRecord(await response.json());
    if (!account || !Array.isArray(account.services) || !account.services.every((s: unknown) => typeof s === "string") || !Array.isArray(account.models)) throw new Error("Invalid hosted service discovery response");
    cached = { ...config, expires: now() + 30_000, account };
    return account;
  };
  const hostedTools = async () => {
    const config = hostedProviderConfig(env);
    if (!config) return [];
    const account = await accountFor(config);
    return [STATUS, ...(account.services.includes("helius") ? [HELIUS] : []),
      ...GROUPS.filter(group => account.services.includes(group.service)).flatMap(group => group.tools.map(tool => ({
        ...tool, providerIdentifier: HOSTED_SERVICE_PROVIDER, inputSchema: tool.inputSchema as JsonValue,
        description: tool.description + " Runs in this user's hosted runtime; file paths refer to the cloud computer.",
      })))].filter(tool => !(options.disabledTools?.() ?? []).includes(tool.toolName));
  };
  const merge = async (existing: Promise<Tool[]>) => {
    const [regular, hosted] = await Promise.all([existing, hostedTools()]);
    // Reserve this provider identity so a user-configured server cannot spoof it.
    return [...regular.filter(tool => tool.providerIdentifier !== HOSTED_SERVICE_PROVIDER), ...hosted];
  };
  return { ...base,
    listHostedServers: async () => {
      const tools = await hostedTools();
      if (!hostedProviderConfig(env)) return [];
      return [{id: HOSTED_SERVICE_PROVIDER, name: "Hosted services", serverIdentifier: HOSTED_SERVICE_PROVIDER,
        accountKey: "current-user", isTeamServer: false, status: "connected", transport: "http", toolCount: tools.length,
        customInstructions: "Use these connected gateway services with the current user's access. Provider credentials are managed on Fly. Configured grants do not prove upstream account readiness."}];
    },
    getTools: (ctx?: unknown) => merge(base.getTools(ctx)),
    getToolsForTurnStart: (ctx?: unknown) => merge(base.getToolsForTurnStart(ctx)),
    resolveProviderTransport: (id: string) => id === HOSTED_SERVICE_PROVIDER ? Promise.resolve("http" as const) : base.resolveProviderTransport(id),
    executeTool: async (ctx: unknown, raw: unknown, auditIdentity: unknown) => {
      const request = asRecord(raw);
      if (request?.providerIdentifier !== HOSTED_SERVICE_PROVIDER) return base.executeTool(ctx, raw, auditIdentity);
      try {
        const config = hostedProviderConfig(env);
        if (!config) throw new Error("Hosted access is not configured.");
        const account = await accountFor(config);
        const name = request.toolName ?? request.name;
        if (!(await hostedTools()).some(tool => tool.toolName === name)) throw new Error("Hosted tool is not enabled for this user.");
        const args = toJsonArgs(asRecord(request.args) ?? {});
        const payload = await withHostedProviderConfig(config, async () => {
          if (name === STATUS.name) return { services: account.services, dailyRequests: account.dailyRequests, usage: account.usage, note: "Configured grants; upstream readiness is not checked." };
          if (name === HELIUS.name) {
            const response = await fetchImpl(config.url + "/helius/rpc", { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
              headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: "hosted-tool", method: args.method, params: args.params ?? [] }) });
            if (!response.ok) throw new Error(`Hosted Helius request failed (HTTP ${response.status}).`);
            return await response.json();
          }
          const group = GROUPS.find(group => group.tools.some(tool => tool.toolName === name))!;
          return group.execute(name, args);
        });
        const row = asRecord(payload);
        const contents: McpToolResultContentItem[] = [];
        if (typeof row?.image_base64 === "string" && row.image_base64.length <= 16_777_216 && /^[A-Za-z0-9+/]*={0,2}$/.test(row.image_base64)) {
          const {image_base64, ...metadata} = row;
          contents.push(resultFactory.textItem(JSON.stringify(metadata)));
          contents.push(new McpToolResultContentItem({content: {case: "image", value: new McpImageContent({data: Buffer.from(image_base64, "base64"), mimeType: "image/png"})}}));
        } else contents.push(resultFactory.textItem(JSON.stringify(payload) ?? "Tool completed."));
        // Log only the allowlisted tool name, never arguments, results, or access.
        try { options.onExecuted?.(name); } catch {}
        return new McpResult({result: {case: "success", value: new McpSuccess({content: contents})}});
      } catch (error) {
        const status = error instanceof Error ? /HTTP (\d{3})/.exec(error.message)?.[1] : undefined;
        return resultFactory.error(status ? `Hosted service request failed (HTTP ${status}).` : "Hosted service request failed. Check the user's service grant and provider availability.");
      }
    },
  };
}

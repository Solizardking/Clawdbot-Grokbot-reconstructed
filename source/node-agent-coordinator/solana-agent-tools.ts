import bs58 from "bs58";

import { isValidSolanaAddress } from "../electron-main/solana/solana-service.js";
import { keypairFromSecret } from "../electron-main/solana/solana-tx-sign.js";
import {
  METAPLEX_API_BASE,
  findAgentIdentityV1Pda,
  findAssetSignerPda,
  findExecutionDelegateRecordV1Pda,
  findExecutiveProfileV1Pda,
} from "../shared/solana-agent-pdas.js";
import { HELIUS_RPC_URL_KEY, deriveHeliusRpcUrl, resolveSolanaBotEnv } from "../shared/solana-bot-env.js";
import {
  boxSecretsReveal,
  createSolanaTradingEnvResolvers,
  heliusTradingConfigured,
  type SolanaTradingPort,
} from "./solana-trading-tools.js";

/**
 * Metaplex Agent Registry surfaces. Mint uses mintAndSubmitAgent on a Umi
 * instance pointed at HELIUS_RPC_URL (injected fetch). Genesis uses
 * createAndRegisterLaunch the same way. DAS reads, PDA derivation, and
 * Agent Tools instructions (registerIdentityV1 / registerExecutiveV1 /
 * delegateExecutionV1 / revokeExecutionV1) also submit through that Helius
 * endpoint — never the public mainnet-beta RPC.
 */
export interface SolanaAgentPort extends Pick<SolanaTradingPort, "fetchImpl" | "heliusRpcUrl" | "revealLocalWalletSecret"> {
  readonly metaplexApiBase?: string;
  /**
   * Optional hook for on-chain Agent Tools instructions (register executive,
   * delegate, revoke). Production uses Umi pointed at HELIUS_RPC_URL.
   */
  readonly sendAgentTools?: (request: AgentToolsSendRequest) => Promise<AgentToolsSendResult>;
}

export interface AgentToolsSendRequest {
  readonly kind: "registerIdentity" | "registerExecutive" | "delegateExecution" | "revokeExecution";
  readonly rpcUrl: string;
  readonly secretKeyBase58: string;
  readonly fetchImpl: typeof fetch;
  readonly agentAsset?: string;
  readonly collection?: string;
  readonly agentRegistrationUri?: string;
  readonly executiveAuthority?: string;
  readonly destination?: string;
}

export interface AgentToolsSendResult {
  readonly signature: string;
  readonly rpcUrl: string;
}

export interface SolanaAgentTool {
  readonly name: string;
  readonly toolName: string;
  readonly providerIdentifier: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const PROVIDER = "grok-bot-local-solana-agents";

const ADDRESS_FIELD = { type: "string", description: "A base58 Solana address (32-44 characters)." } as const;

const MINT_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", description: "App-local wallet that pays rent/fees and becomes the agent owner." },
    name: { type: "string", minLength: 1, maxLength: 32, description: "Agent display name." },
    uri: { type: "string", minLength: 8, description: "Public JSON URI for the Core asset NFT metadata." },
    description: { type: "string", description: "What the agent does. Stored off-chain by the Metaplex API." },
    image: { type: "string", description: "Optional avatar URI recorded in agentMetadata." },
    services: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          endpoint: { type: "string" },
        },
        required: ["name", "endpoint"],
        additionalProperties: false,
      },
    },
    network: { type: "string", enum: ["solana-mainnet", "solana-devnet"], default: "solana-mainnet" },
  },
  required: ["wallet_name", "name", "uri", "description"],
  additionalProperties: false,
} as const;

const READ_SCHEMA = {
  type: "object",
  properties: { asset: ADDRESS_FIELD },
  required: ["asset"],
  additionalProperties: false,
} as const;

const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    owner_address: ADDRESS_FIELD,
    agent_token: ADDRESS_FIELD,
    asset_signer: ADDRESS_FIELD,
    limit: { type: "integer", minimum: 1, maximum: 50, default: 12 },
  },
  additionalProperties: false,
} as const;

const REGISTER_IDENTITY_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", description: "Asset owner wallet that signs registerIdentityV1." },
    asset: ADDRESS_FIELD,
    collection: ADDRESS_FIELD,
    agent_registration_uri: { type: "string", minLength: 8, description: "Public ERC-8004 registration JSON URI." },
  },
  required: ["wallet_name", "asset", "agent_registration_uri"],
  additionalProperties: false,
} as const;

const EXECUTIVE_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", description: "App-local wallet that owns this executive profile (one per wallet)." },
  },
  required: ["wallet_name"],
  additionalProperties: false,
} as const;

const DELEGATE_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", description: "Asset owner wallet that signs the delegation." },
    agent_asset: ADDRESS_FIELD,
    executive_authority: { type: "string", description: "Wallet pubkey of the executive. Defaults to the signing wallet." },
  },
  required: ["wallet_name", "agent_asset"],
  additionalProperties: false,
} as const;

const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    agent_asset: ADDRESS_FIELD,
    executive_authority: ADDRESS_FIELD,
  },
  required: ["agent_asset", "executive_authority"],
  additionalProperties: false,
} as const;

const REVOKE_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", description: "Asset owner or executive authority wallet." },
    agent_asset: ADDRESS_FIELD,
    executive_authority: ADDRESS_FIELD,
  },
  required: ["wallet_name", "agent_asset", "executive_authority"],
  additionalProperties: false,
} as const;

const LAUNCH_SCHEMA = {
  type: "object",
  properties: {
    wallet_name: { type: "string", description: "Funded app-local wallet that signs the Genesis launch." },
    agent_asset: ADDRESS_FIELD,
    name: { type: "string", minLength: 1, maxLength: 32 },
    symbol: { type: "string", minLength: 1, maxLength: 10 },
    image: { type: "string", description: "Irys gateway URL (https://gateway.irys.xyz/…)." },
    description: { type: "string" },
    set_token: { type: "boolean", default: false, description: "Permanently link this mint as the agent's one token. Irreversible." },
    first_buy_sol: { type: "number", description: "Optional fee-free first buy in SOL reserved for the agent PDA." },
    network: { type: "string", enum: ["solana-mainnet", "solana-devnet"], default: "solana-mainnet" },
  },
  required: ["wallet_name", "agent_asset", "name", "symbol", "image"],
  additionalProperties: false,
} as const;

export const SOLANA_AGENT_ROUTED_TOOLS: readonly SolanaAgentTool[] = [
  {
    name: "solana_agent_mint",
    toolName: "solana_agent_mint",
    providerIdentifier: PROVIDER,
    description: "Mint a Metaplex Core agent and register its identity in one transaction via the Metaplex API. The unsigned tx is signed with an app-local wallet and submitted through HELIUS_RPC_URL. Confirm name/uri with the user first; this spends SOL for rent and fees.",
    inputSchema: MINT_SCHEMA,
  },
  {
    name: "solana_agent_register_identity",
    toolName: "solana_agent_register_identity",
    providerIdentifier: PROVIDER,
    description: "Attach an Agent Identity PDA to an already-owned MPL Core asset with registerIdentityV1 (asset, optional collection, agentRegistrationUri). Submits through HELIUS_RPC_URL.",
    inputSchema: REGISTER_IDENTITY_SCHEMA,
  },
  {
    name: "solana_agent_read",
    toolName: "solana_agent_read",
    providerIdentifier: PROVIDER,
    description: "Read a Core asset through Helius DAS and report is_agent, asset_signer, agent_token, plus derived identity/executive PDAs.",
    inputSchema: READ_SCHEMA,
  },
  {
    name: "solana_agent_search",
    toolName: "solana_agent_search",
    providerIdentifier: PROVIDER,
    description: "Discover registered Metaplex agents via Helius DAS searchAssets with isAgent=true. Filter by owner, agent token mint, or asset signer PDA.",
    inputSchema: SEARCH_SCHEMA,
  },
  {
    name: "solana_agent_register_executive",
    toolName: "solana_agent_register_executive",
    providerIdentifier: PROVIDER,
    description: "One-time on-chain executive profile for a wallet (PDA seeds executive_profile + authority). Required before anyone can delegate execution to that wallet. Submits through HELIUS_RPC_URL.",
    inputSchema: EXECUTIVE_SCHEMA,
  },
  {
    name: "solana_agent_delegate_execution",
    toolName: "solana_agent_delegate_execution",
    providerIdentifier: PROVIDER,
    description: "Link a registered agent to an executive so that operator can sign Execute on the agent's Asset Signer PDA. Only the asset owner can delegate. Submits through HELIUS_RPC_URL.",
    inputSchema: DELEGATE_SCHEMA,
  },
  {
    name: "solana_agent_verify_delegation",
    toolName: "solana_agent_verify_delegation",
    providerIdentifier: PROVIDER,
    description: "Derive the execution-delegate PDA and check via Helius getAccountInfo whether the record exists.",
    inputSchema: VERIFY_SCHEMA,
  },
  {
    name: "solana_agent_revoke_execution",
    toolName: "solana_agent_revoke_execution",
    providerIdentifier: PROVIDER,
    description: "Close an execution-delegate record so that executive can no longer Execute through AgentIdentity. Owner or executive may sign. Does not unwind SPL approvals. Submits through HELIUS_RPC_URL.",
    inputSchema: REVOKE_SCHEMA,
  },
  {
    name: "solana_agent_launch_token",
    toolName: "solana_agent_launch_token",
    providerIdentifier: PROVIDER,
    description: "Launch a Genesis bonding-curve token from a registered agent, routing creator fees to the agent PDA. set_token=true is permanent. Image must be an Irys URL. Signs locally and submits through HELIUS_RPC_URL.",
    inputSchema: LAUNCH_SCHEMA,
  },
];

export function isSolanaAgentRoutedTool(name: unknown): boolean {
  return typeof name === "string" && SOLANA_AGENT_ROUTED_TOOLS.some(tool => tool.name === name);
}

export function solanaAgentRoutedTools(env: NodeJS.ProcessEnv = process.env): readonly SolanaAgentTool[] {
  return heliusTradingConfigured(env) ? SOLANA_AGENT_ROUTED_TOOLS : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requireAddress(value: unknown, field: string): string {
  if (!isValidSolanaAddress(value)) throw new Error(`${field} must be a valid base58 Solana address.`);
  return value;
}

function requireWalletName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("wallet_name of an app-local Solana wallet is required.");
  return value.trim();
}

function requireText(value: unknown, field: string, min = 1, max = 512): string {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new Error(`${field} must be ${min}–${max} characters.`);
  return trimmed;
}

function requireSigning(port: SolanaAgentPort): { revealLocalWalletSecret: (raw: unknown) => Promise<string> } {
  if (port.revealLocalWalletSecret == null) {
    throw new Error("Signing wallets are only available in the desktop app; the hosted bridge cannot mint or delegate agents.");
  }
  return { revealLocalWalletSecret: port.revealLocalWalletSecret };
}

function apiBase(port: SolanaAgentPort): string {
  const configured = port.metaplexApiBase?.trim() || process.env.METAPLEX_API_BASE?.trim() || METAPLEX_API_BASE;
  return configured.replace(/\/+$/, "");
}

function asFetch(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetchImpl(input as string, init as RequestInit);
    if (response instanceof Response) return response;
    const like = response as { ok?: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> };
    const text = like.text != null ? await like.text() : JSON.stringify(await like.json?.());
    return new Response(text, { status: like.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function encodeSignature(signature: unknown): string {
  if (typeof signature === "string" && signature.length >= 32) return signature;
  if (signature instanceof Uint8Array) return bs58.encode(signature);
  if (Array.isArray(signature) && signature[0] instanceof Uint8Array) return bs58.encode(signature[0]);
  const row = record(signature);
  if (row?.signature != null && row.signature !== signature) return encodeSignature(row.signature);
  throw new Error("SDK returned no transaction signature.");
}

/** Umi pointed at HELIUS_RPC_URL with the app-local signer and injected fetch. */
export async function createHeliusUmi(rpcUrl: string, fetchImpl: typeof fetch, secretKeyBase58: string) {
  const [{ createUmi }, { keypairIdentity }, { Connection }] = await Promise.all([
    import("@metaplex-foundation/umi-bundle-defaults"),
    import("@metaplex-foundation/umi"),
    import("@solana/web3.js"),
  ]);
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    fetch: asFetch(fetchImpl),
    disableRetryOnRateLimit: true,
  });
  // Confirm over HTTP (getSignatureStatuses) so Electron/tests never open a Helius websocket.
  connection.confirmTransaction = (async (strategy: unknown) => {
    const signature = typeof strategy === "string" ? strategy : (strategy as { signature: string }).signature;
    const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const value = statuses.value[0];
    if (value?.err != null) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(value.err)}`);
    return { context: statuses.context, value: value ?? { err: null } };
  }) as typeof connection.confirmTransaction;
  const umi = createUmi(connection);
  const keypair = umi.eddsa.createKeypairFromSecretKey(bs58.decode(secretKeyBase58));
  umi.use(keypairIdentity(keypair));
  return umi;
}

async function heliusRpc(port: SolanaAgentPort, method: string, params: unknown): Promise<unknown> {
  const url = await port.heliusRpcUrl();
  const response = await port.fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "sand-solana-agent", method, params }),
  });
  const payload: unknown = await response.json().catch(() => null);
  const root = record(payload);
  if (!response.ok || root == null || root.error != null) {
    const error = record(root?.error);
    const detail = error != null && typeof error.message === "string" ? error.message : `HTTP ${response.status}`;
    throw new Error(`Helius ${method} failed: ${detail}`);
  }
  return root.result;
}

function accountExists(result: unknown): boolean {
  if (result == null) return false;
  if (typeof result === "object" && "value" in (result as object)) return (result as { value: unknown }).value != null;
  return true;
}

async function loadAgentRegistry() {
  try {
    return await import("@metaplex-foundation/mpl-agent-registry");
  } catch (error) {
    throw new Error(`Metaplex Agent Registry SDK is not available (${error instanceof Error ? error.message : String(error)}). Install @metaplex-foundation/mpl-agent-registry, umi, and umi-bundle-defaults.`);
  }
}

async function defaultSendAgentTools(request: AgentToolsSendRequest): Promise<AgentToolsSendResult> {
  const [{ publicKey }, registry] = await Promise.all([
    import("@metaplex-foundation/umi"),
    loadAgentRegistry(),
  ]);
  const umi = await createHeliusUmi(request.rpcUrl, request.fetchImpl, request.secretKeyBase58);
  umi.use(registry.mplAgentIdentity());
  umi.use(registry.mplAgentTools());
  if (request.kind === "registerIdentity") {
    const asset = request.agentAsset;
    const uri = request.agentRegistrationUri;
    if (asset == null || uri == null) throw new Error("registerIdentity requires asset and agent_registration_uri.");
    const result = await registry.registerIdentityV1(umi, {
      asset: publicKey(asset),
      ...(request.collection == null ? {} : { collection: publicKey(request.collection) }),
      agentRegistrationUri: uri,
    }).sendAndConfirm(umi);
    return { signature: encodeSignature(result), rpcUrl: request.rpcUrl };
  }
  if (request.kind === "registerExecutive") {
    const result = await registry.registerExecutiveV1(umi, { payer: umi.payer }).sendAndConfirm(umi);
    return { signature: encodeSignature(result), rpcUrl: request.rpcUrl };
  }
  if (request.kind === "delegateExecution") {
    const asset = request.agentAsset;
    if (asset == null) throw new Error("delegateExecution requires agentAsset.");
    const authority = request.executiveAuthority != null ? publicKey(request.executiveAuthority) : umi.identity.publicKey;
    const assetKey = publicKey(asset);
    const agentIdentity = registry.findAgentIdentityV1Pda(umi, { asset: assetKey });
    const executiveProfile = registry.findExecutiveProfileV1Pda(umi, { authority });
    const result = await registry.delegateExecutionV1(umi, { agentAsset: assetKey, agentIdentity, executiveProfile }).sendAndConfirm(umi);
    return { signature: encodeSignature(result), rpcUrl: request.rpcUrl };
  }
  const asset = request.agentAsset;
  const authority = request.executiveAuthority;
  if (asset == null || authority == null) throw new Error("revokeExecution requires agentAsset and executive_authority.");
  const assetKey = publicKey(asset);
  const executiveProfile = registry.findExecutiveProfileV1Pda(umi, { authority: publicKey(authority) });
  const executionDelegateRecord = registry.findExecutionDelegateRecordV1Pda(umi, {
    executiveProfile: publicKey(executiveProfile),
    agentAsset: assetKey,
  });
  const result = await registry.revokeExecutionV1(umi, {
    executionDelegateRecord,
    agentAsset: assetKey,
    destination: request.destination != null ? publicKey(request.destination) : umi.payer.publicKey,
  }).sendAndConfirm(umi);
  return { signature: encodeSignature(result), rpcUrl: request.rpcUrl };
}

function agentSummaryFromDas(payload: unknown, asset: string): Record<string, unknown> {
  const root = record(payload) ?? {};
  const grouping = Array.isArray(root.grouping) ? root.grouping : [];
  const identity = findAgentIdentityV1Pda(asset);
  const wallet = findAssetSignerPda(asset);
  return {
    asset,
    isAgent: root.is_agent === true || root.isAgent === true,
    assetSigner: typeof root.asset_signer === "string" ? root.asset_signer : typeof root.assetSigner === "string" ? root.assetSigner : wallet.address,
    agentToken: typeof root.agent_token === "string" ? root.agent_token : typeof root.agentToken === "string" ? root.agentToken : null,
    identityPda: identity.address,
    derivedAssetSigner: wallet.address,
    interface: typeof root.interface === "string" ? root.interface : null,
    owner: record(root.ownership)?.owner ?? null,
    grouping,
    content: record(root.content)?.metadata ?? null,
  };
}

export async function executeSolanaAgentRoutedTool(port: SolanaAgentPort, name: string, args: unknown): Promise<unknown> {
  const request = record(args) ?? {};
  const rpcUrl = await port.heliusRpcUrl();
  switch (name) {
    case "solana_agent_mint": {
      const { revealLocalWalletSecret } = requireSigning(port);
      const walletName = requireWalletName(request.wallet_name);
      const secretKeyBase58 = await revealLocalWalletSecret({ name: walletName });
      const payer = keypairFromSecret(secretKeyBase58).publicKey;
      const nameText = requireText(request.name, "name", 1, 32);
      const uri = requireText(request.uri, "uri", 8, 512);
      const description = requireText(request.description, "description", 1, 2000);
      const network = request.network === "solana-devnet" ? "solana-devnet" : "solana-mainnet";
      const services = Array.isArray(request.services)
        ? request.services.map(entry => {
          const row = record(entry) ?? {};
          return { name: requireText(row.name, "services.name", 1, 64), endpoint: requireText(row.endpoint, "services.endpoint", 1, 512) };
        })
        : [];
      const umi = await createHeliusUmi(rpcUrl, port.fetchImpl, secretKeyBase58);
      const registry = await import("@metaplex-foundation/mpl-agent-registry");
      umi.use(registry.mplAgentIdentity());
      const minted = await registry.mintAndSubmitAgent(umi, { fetch: asFetch(port.fetchImpl), ...(port.metaplexApiBase != null ? { baseUrl: apiBase(port) } : {}) }, {
        wallet: umi.identity.publicKey,
        network,
        name: nameText,
        uri,
        agentMetadata: {
          type: "agent",
          name: nameText,
          description,
          services,
          registrations: [],
          supportedTrust: [],
        },
      });
      const signature = encodeSignature(minted.signature);
      const assetAddress = minted.assetAddress;
      const identity = assetAddress != null ? findAgentIdentityV1Pda(assetAddress) : null;
      const wallet = assetAddress != null ? findAssetSignerPda(assetAddress) : null;
      return {
        ok: true,
        rpcUrl,
        wallet: payer,
        signature,
        explorer: `https://solscan.io/tx/${signature}`,
        assetAddress,
        identityPda: identity?.address ?? null,
        assetSigner: wallet?.address ?? null,
        network,
        note: "Submitted via HELIUS_RPC_URL. Confirm the AgentIdentity plugin with solana_agent_read after confirmation.",
      };
    }
    case "solana_agent_register_identity": {
      const { revealLocalWalletSecret } = requireSigning(port);
      const walletName = requireWalletName(request.wallet_name);
      const secretKeyBase58 = await revealLocalWalletSecret({ name: walletName });
      const asset = requireAddress(request.asset, "asset");
      const uri = requireText(request.agent_registration_uri, "agent_registration_uri", 8, 512);
      const collection = request.collection == null ? undefined : requireAddress(request.collection, "collection");
      const identity = findAgentIdentityV1Pda(asset);
      const send = port.sendAgentTools ?? defaultSendAgentTools;
      const sent = await send({
        kind: "registerIdentity",
        rpcUrl,
        secretKeyBase58,
        fetchImpl: port.fetchImpl,
        agentAsset: asset,
        ...(collection == null ? {} : { collection }),
        agentRegistrationUri: uri,
      });
      return {
        ok: true,
        rpcUrl: sent.rpcUrl,
        signature: sent.signature,
        explorer: `https://solscan.io/tx/${sent.signature}`,
        asset,
        identityPda: identity.address,
        agentRegistrationUri: uri,
        collection: collection ?? null,
      };
    }
    case "solana_agent_read": {
      const asset = requireAddress(request.asset, "asset");
      const das = await heliusRpc(port, "getAsset", { id: asset, options: { showCollectionMetadata: false, showFungible: true } });
      const identity = findAgentIdentityV1Pda(asset);
      const identityAccount = await heliusRpc(port, "getAccountInfo", [identity.address, { encoding: "base64" }]);
      return {
        ok: true,
        rpcUrl,
        registered: accountExists(identityAccount),
        identityPda: identity.address,
        agent: agentSummaryFromDas(das, asset),
      };
    }
    case "solana_agent_search": {
      const params: Record<string, unknown> = {
        interface: "MplCoreAsset",
        isAgent: true,
        limit: typeof request.limit === "number" && Number.isInteger(request.limit) && request.limit > 0 ? Math.min(request.limit, 50) : 12,
        page: 1,
      };
      if (request.owner_address != null) params.ownerAddress = requireAddress(request.owner_address, "owner_address");
      if (request.agent_token != null) params.agentToken = requireAddress(request.agent_token, "agent_token");
      if (request.asset_signer != null) params.assetSigner = requireAddress(request.asset_signer, "asset_signer");
      const result = await heliusRpc(port, "searchAssets", params);
      const root = record(result) ?? {};
      const items = Array.isArray(root.items) ? root.items.map(item => {
        const row = record(item) ?? {};
        const id = typeof row.id === "string" ? row.id : "";
        return id.length > 0 ? agentSummaryFromDas(row, id) : row;
      }) : [];
      return { ok: true, rpcUrl, total: typeof root.total === "number" ? root.total : items.length, items };
    }
    case "solana_agent_register_executive": {
      const { revealLocalWalletSecret } = requireSigning(port);
      const walletName = requireWalletName(request.wallet_name);
      const secretKeyBase58 = await revealLocalWalletSecret({ name: walletName });
      const authority = keypairFromSecret(secretKeyBase58).publicKey;
      const profile = findExecutiveProfileV1Pda(authority);
      const existing = await heliusRpc(port, "getAccountInfo", [profile.address, { encoding: "base64" }]);
      if (accountExists(existing)) {
        return { ok: true, rpcUrl, alreadyRegistered: true, authority, executiveProfile: profile.address, note: "Each wallet can only have one executive profile." };
      }
      const send = port.sendAgentTools ?? defaultSendAgentTools;
      const sent = await send({ kind: "registerExecutive", rpcUrl, secretKeyBase58, fetchImpl: port.fetchImpl, executiveAuthority: authority });
      return {
        ok: true,
        rpcUrl: sent.rpcUrl,
        signature: sent.signature,
        explorer: `https://solscan.io/tx/${sent.signature}`,
        authority,
        executiveProfile: profile.address,
      };
    }
    case "solana_agent_delegate_execution": {
      const { revealLocalWalletSecret } = requireSigning(port);
      const walletName = requireWalletName(request.wallet_name);
      const secretKeyBase58 = await revealLocalWalletSecret({ name: walletName });
      const owner = keypairFromSecret(secretKeyBase58).publicKey;
      const agentAsset = requireAddress(request.agent_asset, "agent_asset");
      const executiveAuthority = request.executive_authority != null ? requireAddress(request.executive_authority, "executive_authority") : owner;
      const identity = findAgentIdentityV1Pda(agentAsset);
      const profile = findExecutiveProfileV1Pda(executiveAuthority);
      const delegate = findExecutionDelegateRecordV1Pda(profile.address, agentAsset);
      const send = port.sendAgentTools ?? defaultSendAgentTools;
      const sent = await send({
        kind: "delegateExecution",
        rpcUrl,
        secretKeyBase58,
        fetchImpl: port.fetchImpl,
        agentAsset,
        executiveAuthority,
      });
      return {
        ok: true,
        rpcUrl: sent.rpcUrl,
        signature: sent.signature,
        explorer: `https://solscan.io/tx/${sent.signature}`,
        agentAsset,
        agentIdentity: identity.address,
        executiveProfile: profile.address,
        executionDelegateRecord: delegate.address,
        note: "An execution delegate may sign any instruction through Core Execute. Delegate only to operators you trust.",
      };
    }
    case "solana_agent_verify_delegation": {
      const agentAsset = requireAddress(request.agent_asset, "agent_asset");
      const executiveAuthority = requireAddress(request.executive_authority, "executive_authority");
      const profile = findExecutiveProfileV1Pda(executiveAuthority);
      const delegate = findExecutionDelegateRecordV1Pda(profile.address, agentAsset);
      const identity = findAgentIdentityV1Pda(agentAsset);
      const wallet = findAssetSignerPda(agentAsset);
      const account = await heliusRpc(port, "getAccountInfo", [delegate.address, { encoding: "base64" }]);
      return {
        ok: true,
        rpcUrl,
        delegated: accountExists(account),
        agentAsset,
        executiveAuthority,
        executiveProfile: profile.address,
        executionDelegateRecord: delegate.address,
        agentIdentity: identity.address,
        assetSigner: wallet.address,
      };
    }
    case "solana_agent_revoke_execution": {
      const { revealLocalWalletSecret } = requireSigning(port);
      const walletName = requireWalletName(request.wallet_name);
      const secretKeyBase58 = await revealLocalWalletSecret({ name: walletName });
      const agentAsset = requireAddress(request.agent_asset, "agent_asset");
      const executiveAuthority = requireAddress(request.executive_authority, "executive_authority");
      const destination = keypairFromSecret(secretKeyBase58).publicKey;
      const profile = findExecutiveProfileV1Pda(executiveAuthority);
      const delegate = findExecutionDelegateRecordV1Pda(profile.address, agentAsset);
      const send = port.sendAgentTools ?? defaultSendAgentTools;
      const sent = await send({
        kind: "revokeExecution",
        rpcUrl,
        secretKeyBase58,
        fetchImpl: port.fetchImpl,
        agentAsset,
        executiveAuthority,
        destination,
      });
      return {
        ok: true,
        rpcUrl: sent.rpcUrl,
        signature: sent.signature,
        explorer: `https://solscan.io/tx/${sent.signature}`,
        executionDelegateRecord: delegate.address,
        note: "Revocation stops future Execute calls through AgentIdentity. Downstream SPL approvals must be cleaned up separately.",
      };
    }
    case "solana_agent_launch_token": {
      const { revealLocalWalletSecret } = requireSigning(port);
      const walletName = requireWalletName(request.wallet_name);
      const secretKeyBase58 = await revealLocalWalletSecret({ name: walletName });
      const payer = keypairFromSecret(secretKeyBase58).publicKey;
      const agentAsset = requireAddress(request.agent_asset, "agent_asset");
      const tokenName = requireText(request.name, "name", 1, 32);
      const symbol = requireText(request.symbol, "symbol", 1, 10);
      const image = requireText(request.image, "image", 8, 512);
      if (!/^https:\/\/gateway\.irys\.xyz\//i.test(image)) {
        throw new Error("Genesis token image must be an Irys gateway URL (https://gateway.irys.xyz/…).");
      }
      const network = request.network === "solana-devnet" ? "solana-devnet" : "solana-mainnet";
      const setToken = request.set_token === true;
      const firstBuy = typeof request.first_buy_sol === "number" && Number.isFinite(request.first_buy_sol) ? request.first_buy_sol : undefined;
      const umi = await createHeliusUmi(rpcUrl, port.fetchImpl, secretKeyBase58);
      const genesis = await import("@metaplex-foundation/genesis");
      const launched = await genesis.createAndRegisterLaunch(umi, { fetch: asFetch(port.fetchImpl), ...(port.metaplexApiBase != null ? { baseUrl: apiBase(port) } : {}) }, {
        wallet: umi.identity.publicKey,
        network,
        launchType: "bondingCurve",
        agent: { mint: agentAsset, setToken },
        token: {
          name: tokenName,
          symbol,
          image,
          ...(typeof request.description === "string" && request.description.trim().length > 0 ? { description: request.description.trim() } : {}),
        },
        launch: firstBuy == null ? {} : { firstBuyAmount: firstBuy },
      });
      const signature = encodeSignature(launched.signatures?.[0] ?? launched.signatures);
      const launchLink = typeof record(launched.launch)?.link === "string" ? String(record(launched.launch)!.link) : null;
      return {
        ok: true,
        rpcUrl,
        wallet: payer,
        signature,
        explorer: `https://solscan.io/tx/${signature}`,
        mintAddress: launched.mintAddress,
        launch: { link: launchLink },
        agentAsset,
        setToken,
        note: setToken
          ? "setToken is permanent — this mint is now the agent's one canonical token."
          : "Token launched without locking setToken; call again with set_token=true only when you are sure.",
      };
    }
    default:
      throw new Error(`Unknown Solana agent tool: ${name}`);
  }
}

export function createDefaultSolanaAgentPort(options: {
  readonly revealLocalWalletSecret?: (raw: unknown) => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly sendAgentTools?: SolanaAgentPort["sendAgentTools"];
} = {}): SolanaAgentPort {
  return {
    fetchImpl: options.fetchImpl ?? (globalThis.fetch as typeof fetch),
    ...createSolanaTradingEnvResolvers({ revealSecret: async key => boxSecretsReveal(key) }),
    ...(options.revealLocalWalletSecret == null ? {} : { revealLocalWalletSecret: options.revealLocalWalletSecret }),
    ...(options.sendAgentTools == null ? {} : { sendAgentTools: options.sendAgentTools }),
  };
}

export async function resolveAgentHeliusRpcUrl(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly revealSecret?: (key: string) => Promise<string | null>;
} = {}): Promise<string> {
  const resolved = await resolveSolanaBotEnv(options);
  const explicit = resolved[HELIUS_RPC_URL_KEY];
  if (explicit != null) return explicit;
  const key = resolved.HELIUS_API_KEY;
  if (key != null) return deriveHeliusRpcUrl(key);
  throw new Error("Helius is not configured. Set HELIUS_RPC_URL or HELIUS_API_KEY (env or Settings → Solana panel).");
}

export const CONNECTOR_IDS = ["jupiter", "phantom", "pumpfun", "helius", "paybox", "lobster"] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export type ConnectorSecrets = Record<string, string | null | undefined>;

export type ConnectorDescriptor = {
  id: ConnectorId;
  label: string;
  tagline: string;
  secretKeys: readonly string[];
  /** True when the venue works without a saved secret. */
  keyless: boolean;
  connectUrl: string;
};

export const CONNECTORS: readonly ConnectorDescriptor[] = [
  {
    id: "jupiter",
    label: "Jupiter",
    tagline: "Swaps on Solana. Keyless quotes; optional API key.",
    secretKeys: ["JUPITER_API_KEY"],
    keyless: true,
    connectUrl: "https://jup.ag",
  },
  {
    id: "phantom",
    label: "Phantom",
    tagline: "Server wallets via Phantom organization credentials.",
    secretKeys: ["PHANTOM_ORGANIZATION_ID", "PHANTOM_APP_ID", "PHANTOM_API_PRIVATE_KEY"],
    keyless: false,
    connectUrl: "https://phantom.app",
  },
  {
    id: "pumpfun",
    label: "Pump.fun",
    tagline: "Live launch tape from clawd-ws.fly.dev.",
    secretKeys: [],
    keyless: true,
    connectUrl: "https://clawd-ws.fly.dev/",
  },
  {
    id: "helius",
    label: "Helius",
    tagline: "DAS + RPC for balances and assets.",
    secretKeys: ["HELIUS_API_KEY"],
    keyless: false,
    connectUrl: "https://www.helius.dev",
  },
  {
    id: "paybox",
    label: "PayBox",
    tagline: "Agent payments. Login with npm run paybox:login.",
    secretKeys: ["PAYBOX_ACCESS_TOKEN", "PAYBOX_SIGNING_KEY", "PAYBOX_API_KEY"],
    keyless: false,
    connectUrl: "https://paybox.sh",
  },
  {
    id: "lobster",
    label: "lobster",
    tagline: "Clawd 🦞 gateway for local agent identity.",
    secretKeys: ["CLAWD_GATEWAY_URL", "CLAWD_GATEWAY_TOKEN"],
    keyless: true,
    connectUrl: "https://solanaclawd.com",
  },
];

function present(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function descriptor(id: unknown): ConnectorDescriptor | undefined {
  return CONNECTORS.find((row) => row.id === id);
}

export type ConnectorStatus = {
  id: ConnectorId;
  label: string;
  tagline: string;
  configured: boolean;
  keyless: boolean;
  connectUrl: string;
  missing: string[];
};

export function connectorStatus(id: ConnectorId, secrets: ConnectorSecrets = {}): ConnectorStatus {
  const row = descriptor(id);
  if (row == null) throw new Error(`Unknown connector: ${String(id)}`);
  const missing = row.secretKeys.filter((key) => !present(secrets[key]));
  const configured = row.keyless || missing.length === 0;
  return {
    id: row.id,
    label: row.label,
    tagline: row.tagline,
    configured,
    keyless: row.keyless,
    connectUrl: row.connectUrl,
    missing: row.keyless ? missing : missing,
  };
}

export type ConnectorConnectResult = ConnectorStatus & {
  ok: boolean;
  state: "connected" | "ready" | "needs-key";
  error: string | null;
};

export function connectConnector(id: ConnectorId, secrets: ConnectorSecrets = {}): ConnectorConnectResult {
  const status = connectorStatus(id, secrets);
  if (!status.keyless && status.missing.length > 0) {
    return {
      ...status,
      ok: false,
      state: "needs-key",
      error: `Save ${status.missing.join(", ")} to connect ${status.label}.`,
    };
  }
  const state: ConnectorConnectResult["state"] =
    !status.keyless ? "connected" : status.missing.length === 0 ? "connected" : "ready";
  return {
    ...status,
    configured: true,
    ok: true,
    state,
    error: null,
  };
}

export function listConnectorStatuses(secrets: ConnectorSecrets = {}): ConnectorStatus[] {
  return CONNECTORS.map((row) => connectorStatus(row.id, secrets));
}

export function secretsFromEnv(env: Record<string, string | undefined> = {}): ConnectorSecrets {
  const keys = CONNECTORS.flatMap((row) => row.secretKeys);
  const out: ConnectorSecrets = {};
  for (const key of keys) out[key] = env[key] ?? null;
  return out;
}

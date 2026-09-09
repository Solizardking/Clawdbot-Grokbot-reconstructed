/**
 * Solana trading environment shared by every bot surface (desktop coordinator,
 * Telegram bridge, hosted bridge, Fly deployment). Resolution order:
 * process env first, then the app secret store; HELIUS_RPC_URL is derived
 * from HELIUS_API_KEY when it is not set explicitly.
 */
export const HELIUS_RPC_URL_KEY = "HELIUS_RPC_URL";
export const HELIUS_API_KEY_ENV = "HELIUS_API_KEY";
export const JUPITER_API_KEY_ENV = "JUPITER_API_KEY";
export const BIRDEYE_API_KEY_ENV = "BIRDEYE_API_KEY";

export const SOLANA_BOT_ENV_KEYS = [HELIUS_RPC_URL_KEY, HELIUS_API_KEY_ENV, JUPITER_API_KEY_ENV, BIRDEYE_API_KEY_ENV, "SOLANA_TRACKER_SECURE_RPC", "SOLANA_TRACKER_RPC_URL", "SOLANA_TRACKER_WSS_URL", "SOLANA_TRACKER_ACCESS_KEY", "SOLANA_RPC_URL", "RPC_URL", "SECURE_RPC_URL", "WSS_URL", "ACCESS_KEY", "EXA_API_KEY", "TAVILY_API_KEY", "SERP_API_KEY"] as const;
export type SolanaBotEnvKey = (typeof SOLANA_BOT_ENV_KEYS)[number];

export const HELIUS_RPC_URL_TEMPLATE = "https://mainnet.helius-rpc.com/?api-key=";

export function deriveHeliusRpcUrl(apiKey: string): string {
  return `${HELIUS_RPC_URL_TEMPLATE}${encodeURIComponent(apiKey.trim())}`;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export type SecretReveal = (key: string) => Promise<string | null>;

/**
 * Resolves the three trading keys without mutating anything. Existing env
 * values win; missing values fall back to the secret store; HELIUS_RPC_URL
 * is derived from HELIUS_API_KEY when neither source provides it.
 */
export async function resolveSolanaBotEnv(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly revealSecret?: SecretReveal;
}): Promise<Partial<Record<SolanaBotEnvKey, string>>> {
  const env = options.env ?? process.env;
  const resolved: Partial<Record<SolanaBotEnvKey, string>> = {};
  const fromEnv: Partial<Record<SolanaBotEnvKey, string>> = {};
  for (const key of SOLANA_BOT_ENV_KEYS) {
    const value = nonEmpty(env[key]);
    if (value != null) fromEnv[key] = value;
  }
  const fromSecrets: Partial<Record<SolanaBotEnvKey, string>> = {};
  if (options.revealSecret != null) {
    for (const key of SOLANA_BOT_ENV_KEYS) {
      if (fromEnv[key] != null) continue;
      const value = nonEmpty(await options.revealSecret(key));
      if (value != null) fromSecrets[key] = value;
    }
  }
  for (const key of SOLANA_BOT_ENV_KEYS) {
    const value = fromEnv[key] ?? fromSecrets[key];
    if (value != null) resolved[key] = value;
  }
  const trackerRpc = resolved.SOLANA_TRACKER_RPC_URL ?? resolved.SOLANA_RPC_URL ?? resolved.RPC_URL ?? resolved.SOLANA_TRACKER_SECURE_RPC ?? resolved.SECURE_RPC_URL;
  if (trackerRpc != null) resolved[HELIUS_RPC_URL_KEY] ??= trackerRpc;
  if (resolved[HELIUS_RPC_URL_KEY] == null && resolved[HELIUS_API_KEY_ENV] != null) {
    resolved[HELIUS_RPC_URL_KEY] = deriveHeliusRpcUrl(resolved[HELIUS_API_KEY_ENV]!);
  }
  return resolved;
}

/**
 * Fills only missing keys on the target env object (typically process.env),
 * so explicit operator configuration is never overwritten.
 */
export function applySolanaBotEnv(
  resolved: Partial<Record<SolanaBotEnvKey, string>>,
  target: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of SOLANA_BOT_ENV_KEYS) {
    const value = resolved[key];
    if (value == null) continue;
    if (nonEmpty(target[key]) == null) target[key] = value;
  }
}

/**
 * Convenience for entrypoints: resolve from env + secret store, then apply
 * onto process.env. Returns the resolved values for status reporting.
 */
export async function injectSolanaBotEnv(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly target?: NodeJS.ProcessEnv;
  readonly revealSecret?: SecretReveal;
}): Promise<Partial<Record<SolanaBotEnvKey, string>>> {
  const resolved = await resolveSolanaBotEnv(options);
  applySolanaBotEnv(resolved, options.target ?? process.env);
  return resolved;
}

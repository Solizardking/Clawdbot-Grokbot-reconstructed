import { AsyncLocalStorage } from 'node:async_hooks';

type HostedConfig = { url: string; token: string };
const hostedInvocation = new AsyncLocalStorage<{ config: HostedConfig | undefined }>();

/** Keep concurrent conversations' access isolated without changing process.env. */
export function withHostedProviderConfig<T>(config: HostedConfig | undefined, run: () => T): T {
  const validated = config === undefined ? undefined : parseHostedProviderConfig({
    SAND_HOSTED_GATEWAY_URL: config.url, SAND_HOSTED_GATEWAY_TOKEN: config.token,
  });
  return hostedInvocation.run({ config: validated }, run);
}

/** Routes inference through the hosted broker without exporting operator keys. */
export async function resolveHostedProviderConfig(reveal: (key: string) => Promise<string | null>, env: Record<string, string | undefined> = process.env) {
  const values = { ...env };
  for (const key of ["SAND_HOSTED_GATEWAY_URL", "SAND_HOSTED_GATEWAY_TOKEN"]) {
    if (!values[key]?.trim()) values[key] = (await reveal(key)) ?? undefined;
  }
  return hostedProviderConfig(values);
}

export function hostedProviderConfig(values: Record<string, string | undefined>): { url: string; token: string } | undefined {
  const invocation = hostedInvocation.getStore();
  return invocation ? invocation.config : parseHostedProviderConfig(values);
}

function parseHostedProviderConfig(values: Record<string, string | undefined>): HostedConfig | undefined {
  const raw = values.SAND_HOSTED_GATEWAY_URL?.trim();
  const token = values.SAND_HOSTED_GATEWAY_TOKEN?.trim();
  if (!raw && !token) return undefined;
  if (!raw || !token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error("Hosted gateway needs a URL and valid user access token.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Hosted gateway URL must be an HTTPS origin.");
  return { url: url.origin, token };
}

export function createHostedProviderFetch(config: { url: string; token: string } | undefined, fetchImpl: typeof fetch = fetch): typeof fetch {
  if (!config) return fetchImpl;
  return async (input, init) => {
    const request = new Request(input, init);
    const provider = request.url === "https://openrouter.ai/api/v1/chat/completions" ? "openrouter"
      : request.url === "https://api.x.ai/v1/chat/completions" ? "xai" : undefined;
    if (!provider) throw new Error("Unsupported hosted provider endpoint");
    const headers = new Headers({ "content-type": "application/json", authorization: `Bearer ${config.token}` });
    return fetchImpl(`${config.url}/${provider}/v1/chat/completions`, {
      method: request.method, headers, body: await request.text(), signal: request.signal, redirect: "error",
    });
  };
}

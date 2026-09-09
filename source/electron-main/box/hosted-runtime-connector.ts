import type { SandRemoteHostConnector } from './box-host-connector.js';

type HostedAccess = { url: string; token: string };

/** Hosted access selects an operator-assigned, per-user computer. */
export function createHostedRuntimeConnector(
  remote: SandRemoteHostConnector,
  readAccess: () => Promise<HostedAccess | undefined>,
  fetchImpl: typeof fetch = fetch,
): SandRemoteHostConnector {
  return {
    async connect() {
      const access = await readAccess();
      if (!access) return remote.connect();
      let response: Response;
      try {
        response = await fetchImpl(`${access.url}/v1/runtime`, {
          headers: { authorization: `Bearer ${access.token}` },
          redirect: 'error', signal: AbortSignal.timeout(20_000),
        });
      } catch { throw new Error('Cannot reach your hosted computer service.'); }
      if (!response.ok) throw new Error(response.status === 404
        ? 'Your hosted computer has not been provisioned yet.'
        : `Hosted computer lookup failed (HTTP ${response.status}).`);
      const body = await response.json() as { transport?: unknown };
      if (body.transport !== 'gateway') throw new Error('The hosted computer service returned an unsupported transport.');
      // The public gateway checks each request and routes it to a private Fly
      // app assigned to this user. Health probes also need the bearer header.
      return { baseUrl: access.url, token: access.token, headers: { authorization: `Bearer ${access.token}` } };
    },
    async issueInferenceCredential() {
      return await readAccess() ? undefined : remote.issueInferenceCredential?.();
    },
    async issueLocalExecDaemonCredential() {
      return await readAccess() ? undefined : remote.issueLocalExecDaemonCredential?.();
    },
    async recreate(args) {
      if (await readAccess()) throw new Error('Hosted computer restarts are managed by your gateway operator.');
      if (!remote.recreate) throw new Error('Computer recreation is unavailable.');
      return remote.recreate(args);
    },
    async forceRecreate() {
      if (await readAccess()) return { status: 'rejected', reason: 'Hosted computer resets are managed by your gateway operator.' };
      return remote.forceRecreate?.() ?? { status: 'rejected', reason: 'Computer reset is unavailable.' };
    },
  };
}

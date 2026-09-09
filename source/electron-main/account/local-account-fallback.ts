import type { SandAuthStatus } from "./cursor-auth.js";
import type { AuthServicePort } from "./cursor-auth-wiring.js";

/** Deterministic identity used when no Cursor session exists. */
export const LOCAL_ACCOUNT_AUTH_ID = "local-openrouter";

export function createLocalAccountStatus(): SandAuthStatus {
  return { kind: "logged-in", authId: LOCAL_ACCOUNT_AUTH_ID };
}

export interface LocalAccountFallbackOptions {
  /** Fallback applies only while the routed provider does not need Cursor. */
  readonly isEnabled: () => boolean;
  readonly onProblem?: (domain: string, error: unknown) => void;
}

function isRealLoggedIn(status: SandAuthStatus): boolean {
  return status.kind === "logged-in";
}

/**
 * Presents a deterministic local account whenever the routed inference
 * provider does not require a Cursor session and no real Cursor credentials
 * exist. Real sessions always win, and token-backed operations stay honest so
 * Cursor-backed features keep their normal sign-in behavior.
 */
export function wrapAuthServiceWithLocalAccountFallback(
  service: AuthServicePort,
  options: LocalAccountFallbackOptions,
): AuthServicePort {
  const resolve = async (status: SandAuthStatus): Promise<SandAuthStatus> => {
    if (isRealLoggedIn(status)) return status;
    if (!options.isEnabled()) return status;
    return createLocalAccountStatus();
  };
  const settled = async (operation: Promise<SandAuthStatus>): Promise<SandAuthStatus> =>
    await resolve(await operation);
  const deliver = (listener: (status: SandAuthStatus) => void, status: SandAuthStatus): void => {
    void resolve(status).then(
      (mapped) => {
        try { listener(mapped); } catch (error) { options.onProblem?.("auth-listener", error); }
      },
      (error) => { options.onProblem?.("auth-fallback", error); },
    );
  };
  return {
    getStatus: async () => await resolve(await service.getStatus()),
    subscribe(listener) {
      return service.subscribe((status) => deliver(listener, status));
    },
    login: () => settled(service.login()),
    cancelLogin: () => settled(service.cancelLogin()),
    logout: () => settled(service.logout()),
    getValidAccessToken: (request) => service.getValidAccessToken(request),
    ...(service.peekAccessToken == null ? {} : { peekAccessToken: () => service.peekAccessToken!() }),
    revokeForAccountRefusal: () => service.revokeForAccountRefusal(),
    updateDisplayName: (name) => service.updateDisplayName(name),
    ...(service.devLogin == null ? {} : { devLogin: (args) => settled(service.devLogin!(args)) }),
  };
}

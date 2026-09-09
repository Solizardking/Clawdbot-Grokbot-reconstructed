import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BANDOS_SFX_BASE64, KACHING_SFX_BASE64 } from "./sfx-data.js";

export { BANDOS_SFX_BASE64, KACHING_SFX_BASE64 };

const DEBOUNCE_MS = 4_000;

export interface LoginFanfareState {
  /** True once any auth status has been delivered, so session restore at launch stays silent. */
  readonly hasSeenStatus: boolean;
  readonly wasSignedIn: boolean;
  readonly nextSignedIn: boolean;
  readonly authId: string | undefined;
}

export const LOCAL_ACCOUNT_AUTH_ID = "local-openrouter";

/** Only a real, interactive sign-in (not session restore, not the local account) earns the fanfare. */
export function shouldPlayLoginFanfare(state: LoginFanfareState): boolean {
  if (!state.hasSeenStatus) return false;
  if (state.nextSignedIn !== true || state.wasSignedIn !== false) return false;
  return state.authId !== LOCAL_ACCOUNT_AUTH_ID;
}

export interface PlaySfxDeps {
  readonly spawnImpl?: typeof spawn;
  readonly now?: () => number;
  readonly platform?: NodeJS.Platform;
}

/**
 * Plays the embedded login fanfare: ka-ching, then "thanks for the bandos".
 * Audio is decoded to a temp directory and played with the macOS afplay CLI;
 * every failure is swallowed — sound must never block or break sign-in.
 */
export function createLoginFanfarePlayer(deps: PlaySfxDeps = {}) {
  const spawnImpl = deps.spawnImpl ?? spawn;
  const now = deps.now ?? (() => Date.now());
  const platform = deps.platform ?? process.platform;
  let lastPlayAtMs = 0;

  return {
    shouldPlay: shouldPlayLoginFanfare,
    play(): void {
      if (platform !== "darwin") return;
      const at = now();
      if (at - lastPlayAtMs < DEBOUNCE_MS) return;
      lastPlayAtMs = at;
      void (async () => {
        const directory = await mkdtemp(join(tmpdir(), "sand-sfx-"));
        try {
          for (const [index, base64] of [KACHING_SFX_BASE64, BANDOS_SFX_BASE64].entries()) {
            const file = join(directory, `sfx-${index}`);
            await writeFile(file, Buffer.from(base64, "base64"));
            await new Promise<void>((resolve) => {
              const child = spawnImpl("afplay", [file], { stdio: "ignore" });
              child.on("exit", () => resolve());
              child.on("error", () => resolve());
            });
          }
        } catch {
          // Audio is best-effort decoration; ignore every failure.
        } finally {
          await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        }
      })();
    },
  };
}

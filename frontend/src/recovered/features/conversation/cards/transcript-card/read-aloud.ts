import type { SpeechSynthesisResult } from "../../../../contracts/desktop-bridge";

// Free OpenRouter TTS playback ("Read aloud" on agent messages). Speech bytes
// are synthesized in the main process via speechSynthesize → OpenRouter's
// zero-cost deepgram/flux-tts:free model chain and played back here.

export type ReadAloudStatus = "loading" | "playing";

export interface ReadAloudState {
  readonly entryId: string | null;
  readonly status: ReadAloudStatus | null;
}

export type ReadAloudSynthesizer = (request: { text: string }) => Promise<SpeechSynthesisResult>;

export type ReadAloudAudioConstructor = new (src: string) => HTMLAudioElement;

export interface ReadAloudController {
  toggle(entryId: string, text: string): Promise<void>;
  stop(): void;
  getState(): ReadAloudState;
  subscribe(listener: (state: ReadAloudState) => void): () => void;
}

const IDLE_STATE: ReadAloudState = { entryId: null, status: null };

function browserAudioConstructor(): ReadAloudAudioConstructor | undefined {
  return typeof globalThis.Audio === "function" ? globalThis.Audio : undefined;
}

function dataUrlFor(result: SpeechSynthesisResult): string {
  return `data:audio/${result.format};base64,${result.audioBase64}`;
}

export function createReadAloudController(options: {
  synthesize: ReadAloudSynthesizer;
  audioConstructor?: ReadAloudAudioConstructor | null;
}): ReadAloudController {
  const audioConstructor = options.audioConstructor === undefined ? browserAudioConstructor() : options.audioConstructor;
  let state: ReadAloudState = IDLE_STATE;
  let audio: HTMLAudioElement | null = null;
  const listeners = new Set<(state: ReadAloudState) => void>();
  const publish = (): void => { for (const listener of listeners) listener(state); };
  const setState = (next: ReadAloudState): void => { state = next; publish(); };
  const stop = (): void => {
    if (audio != null) {
      audio.pause();
      audio.removeAttribute("src");
      audio = null;
    }
    setState(IDLE_STATE);
  };

  return {
    async toggle(entryId, text) {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      if (state.entryId === entryId && state.status != null) { stop(); return; }
      stop();
      setState({ entryId, status: "loading" });
      try {
        const result = await options.synthesize({ text: trimmed });
        if (state.entryId !== entryId) return;
        if (audioConstructor == null || result.audioBase64.length === 0) { stop(); return; }
        const element = new audioConstructor(dataUrlFor(result));
        element.onended = () => { if (audio === element) stop(); };
        element.onerror = () => { if (audio === element) stop(); };
        audio = element;
        await element.play();
        if (audio !== element) { element.pause(); return; }
        setState({ entryId, status: "playing" });
      } catch {
        if (state.entryId === entryId) stop();
      }
    },
    stop,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

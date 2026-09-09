import {
  createPumpTapeStore,
  DEFAULT_PUMP_WS_URL,
  parsePumpMessage,
  type PumpLaunchMessage,
  type PumpTapeStore,
} from "../../server/solana/pump-tape";

export { createPumpTapeStore, DEFAULT_PUMP_WS_URL, parsePumpMessage };
export type { PumpLaunchMessage, PumpTapeStore };

export const PUMP_TAPE_HTTP = "https://clawd-ws.fly.dev/";
export const PUMP_TAPE_WS = DEFAULT_PUMP_WS_URL;

export function applyTapeJson(store: PumpTapeStore, raw: string): PumpLaunchMessage[] {
  const message = parsePumpMessage(raw);
  if (message != null) store.apply(message);
  return store.recent({ limit: 20 });
}

export type IntroTapeClient = {
  store: PumpTapeStore;
  start(): void;
  stop(): void;
  recent(): PumpLaunchMessage[];
};

export function createIntroTapeClient(options?: {
  url?: string;
  open?: (url: string) => WebSocket;
  onChange?: () => void;
}): IntroTapeClient {
  const store = createPumpTapeStore();
  const url = options?.url?.trim() || PUMP_TAPE_WS;
  const onChange = options?.onChange ?? (() => {});
  let socket: WebSocket | null = null;
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;

  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      connect();
    }, delay);
    delay = Math.min(delay * 2, 30_000);
  };

  const connect = () => {
    if (stopped || socket) return;
    let current: WebSocket;
    try {
      current = (options?.open ?? ((target) => new WebSocket(target)))(url);
    } catch {
      schedule();
      return;
    }
    socket = current;
    current.onopen = () => {
      if (socket !== current || stopped) return;
      delay = 1000;
      onChange();
    };
    current.onmessage = (event) => {
      if (socket !== current || stopped || typeof event.data !== "string") return;
      applyTapeJson(store, event.data);
      onChange();
    };
    current.onerror = () => {
      if (socket === current) current.close();
    };
    current.onclose = () => {
      if (socket === current) {
        socket = null;
        schedule();
      }
    };
  };

  return {
    store,
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      const current = socket;
      socket = null;
      current?.close();
    },
    recent() {
      return store.recent({ limit: 12 });
    },
  };
}

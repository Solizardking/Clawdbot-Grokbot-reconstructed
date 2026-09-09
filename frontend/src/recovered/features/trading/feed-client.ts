import { createPumpTapeStore, parsePumpMessage } from '../../../../../source/shared/pump-feed';
export const RELAY_URL = 'wss://clawd-ws.fly.dev/ws';
export type FeedConnection = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'closed';
export function createTradingFeedClient(options: { open?: (url: string) => WebSocket; onChange: () => void; url?: string }) {
  const store = createPumpTapeStore({ maxLaunches: 120, maxEnrichments: 600 });
  let socket: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true, delay = 1000, state: FeedConnection = 'closed';
  let lastMessage = 0;
  function schedule() { if (stopped || timer) return; state = 'reconnecting'; options.onChange(); timer = setTimeout(() => { timer = undefined; connect(); }, delay); delay = Math.min(delay * 2, 30000); }
  function connect() {
    if (stopped || socket) return;
    state = 'connecting'; options.onChange();
    let current: WebSocket;
    try { current = (options.open ?? (url => new WebSocket(url)))(options.url ?? RELAY_URL); } catch { schedule(); return; }
    socket = current;
    current.onopen = () => { if (socket !== current || stopped) return; delay = 1000; state = 'live'; options.onChange(); };
    current.onmessage = event => {
      if (socket !== current || stopped || typeof event.data !== 'string' || event.data.length > 200000) return;
      const message = parsePumpMessage(event.data);
      if (!message) return;
      lastMessage = Date.now(); store.apply(message); options.onChange();
    };
    current.onerror = () => { if (socket === current) { state = 'offline'; options.onChange(); current.close(); } };
    current.onclose = () => { if (socket === current) { socket = null; schedule(); } };
  }
  return { store, status: () => ({ state, lastMessage }), start() { if (!stopped) return; stopped = false; connect(); }, stop() { stopped = true; clearTimeout(timer); timer = undefined; const current = socket; socket = null; current?.close(); state = 'closed'; options.onChange(); } };
}

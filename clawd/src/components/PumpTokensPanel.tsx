import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Copy, Pause, Play, Search, X } from "lucide-react";
import { applySkin, readSkin, type SkinId } from "@/lib/skins";
import { mergePumpToken, parsePumpToken, type PumpToken } from "@/lib/pump-feed";
import { SolanaSettings } from "./SolanaSettings";

const MODE_KEY = "clawd-solana-mode";
function rememberedMode() { try { return localStorage.getItem(MODE_KEY) === "1"; } catch { return false; } }

export function PumpTokensPanel({ overlay = false }: { overlay?: boolean }) {
  const [mode, setMode] = useState(rememberedMode);
  const [open, setOpen] = useState(rememberedMode);
  const [tab, setTab] = useState<"discover" | "wallets">("discover");
  const [tokens, setTokens] = useState<PumpToken[]>([]);
  const [status, setStatus] = useState("Connecting");
  const [lastEvent, setLastEvent] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  const [query, setQuery] = useState("");
  const [githubOnly, setGithubOnly] = useState(false);
  const [notice, setNotice] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const previousSkin = useRef<SkinId>((() => {
    try { const saved = localStorage.getItem("clawd-solana-previous-skin"); return saved && ["midnight", "atelier", "foundry", "lagoon", "solana"].includes(saved) ? saved as SkinId : readSkin(); } catch { return readSkin(); }
  })());
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const changeMode = (enabled: boolean) => {
    if (enabled) {
      if (!rememberedMode()) {
        previousSkin.current = readSkin();
        try { localStorage.setItem("clawd-solana-previous-skin", previousSkin.current); } catch { /* session only */ }
      }
      applySkin("solana");
    }
    else applySkin(previousSkin.current);
    setMode(enabled);
    try { localStorage.setItem(MODE_KEY, enabled ? "1" : "0"); } catch { /* session preference still works */ }
  };
  useEffect(() => { if (rememberedMode()) applySkin("solana"); }, []);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => {
    const show = () => { trigger.current = document.activeElement as HTMLElement; setTab("discover"); setOpen(true); };
    const solana = () => { show(); changeMode(true); };
    window.addEventListener("clawd:open-pump-tokens", show);
    window.addEventListener("clawd:open-solana", solana);
    return () => { window.removeEventListener("clawd:open-pump-tokens", show); window.removeEventListener("clawd:open-solana", solana); };
  }, []);
  useEffect(() => { if (open) closeButton.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    const connect = () => {
      setStatus("Connecting");
      socket = new WebSocket("wss://clawd-ws.fly.dev/ws");
      socket.onopen = () => { if (disposed) return; delay = 1000; setStatus("Waiting for upstream"); };
      socket.onmessage = (event) => {
        if (disposed) return;
        let data: unknown;
        try { data = JSON.parse(event.data); } catch { return; }
        const token = parsePumpToken(data);
        if (token) {
          setLastEvent(Date.now()); setStatus("Live");
          if (!pausedRef.current) setTokens(rows => mergePumpToken(rows, token));
        } else if (data && typeof data === "object" && "type" in data && data.type === "status" && "connected" in data) {
          setLastEvent(Date.now()); setStatus(data.connected === true ? "Live" : "Upstream offline");
        }
      };
      socket.onerror = () => { if (!disposed) setStatus("Connection error"); socket?.close(); };
      socket.onclose = () => {
        if (disposed) return;
        setStatus("Reconnecting"); retry = setTimeout(connect, delay); delay = Math.min(delay * 2, 30000);
      };
    };
    connect();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { disposed = true; clearTimeout(retry); clearInterval(clock); socket?.close(); };
  }, [open]);
  if (!open) return null;
  const stale = lastEvent > 0 && now - lastEvent > 45000;
  const feedStatus = paused ? "Paused" : stale ? "Stale · last known data" : status;
  const rows = tokens.filter(row => (!githubOnly || row.hasGithub) && `${row.name} ${row.symbol} ${row.mint}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <aside aria-label="Solana workspace" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} className={`solana-workspace ${overlay ? "solana-workspace-overlay" : ""} flex min-h-0 shrink-0 flex-col border-l border-hairline/40 bg-panel text-ink`}>
      <header className="solana-workspace-header flex items-center gap-3 border-b border-hairline/40 px-5 py-4">
        <img src="./brand/solana/logomark.svg" alt="" className="size-7" />
        <div className="min-w-0 flex-1"><h2 className="text-base font-semibold">{mode ? "Solana workspace" : "Pump.fun tokens"}</h2><p className="text-xs text-ink-secondary">Discover. Research. Build.</p></div>
        <button ref={closeButton} type="button" onClick={close} aria-label="Close Solana workspace" className="rounded-lg p-2 hover:bg-raised"><X size={18} /></button>
      </header>
      <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-3 text-xs">
        <span className="text-ink-secondary">Solana mode</span>
        <button type="button" role="switch" aria-checked={mode} onClick={() => changeMode(!mode)} className="rounded-full border border-hairline bg-control px-3 py-1 text-ink">{mode ? "On · purple + green" : "Enable Solana mode"}</button>
      </div>
      <div role="tablist" aria-label="Solana workspace views" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "discover" : event.key === "End" ? "wallets" : tab === "discover" ? "wallets" : "discover";
        setTab(next); document.getElementById(`solana-tab-${next}`)?.focus();
      }} className="flex gap-2 px-5 py-3">
        {([['discover', 'Pump.fun'], ['wallets', 'Wallets & assets']] as const).map(([id, label]) => <button key={id} role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`solana-${id}`} id={`solana-tab-${id}`} onClick={() => setTab(id)} className={`rounded-lg px-3 py-2 text-sm ${tab === id ? 'bg-raised text-ink' : 'text-ink-secondary hover:bg-raised'}`}>{label}</button>)}
      </div>
      {tab === "wallets" ? <section role="tabpanel" id="solana-wallets" aria-labelledby="solana-tab-wallets" className="min-h-0 flex-1 overflow-y-auto px-5 pb-5"><SolanaSettings /></section> : <section role="tabpanel" id="solana-discover" aria-labelledby="solana-tab-discover" className="flex min-h-0 flex-1 flex-col">
        <div className="px-5 pb-3">
          <div className="mb-3 flex items-center justify-between text-xs"><span role="status" className={feedStatus === "Live" ? "text-success" : "text-warning"}>● {feedStatus}</span><span className="text-ink-secondary">{tokens.length} launches in session</span></div>
          <label className="flex items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-3 py-2"><Search size={14} className="text-ink-secondary" /><input aria-label="Search tokens by name, symbol or mint" placeholder="Search name, symbol or mint" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
          <div className="mt-3 flex items-center justify-between text-xs"><label className="flex items-center gap-2 text-ink-secondary"><input type="checkbox" checked={githubOnly} onChange={event => setGithubOnly(event.target.checked)} /> Has GitHub</label><button onClick={() => setPaused(value => !value)} className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-raised">{paused ? <Play size={12} /> : <Pause size={12} />}{paused ? "Resume" : "Pause"}</button></div>
          {paused && <p className="mt-2 text-xs text-warning">New launches are skipped while paused.</p>}
          {notice && <p role="status" className="mt-2 text-xs text-ink-secondary">{notice}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {rows.length === 0 && <div className="rounded-xl border border-dashed border-hairline p-6 text-center"><p className="text-sm">{tokens.length ? "No matching launches" : "Waiting for token launches"}</p><p className="mt-2 text-xs leading-relaxed text-ink-secondary">{tokens.length ? "Try another search or turn off the GitHub filter." : "New Pump.fun tokens appear here as the relay receives them. Connection status is shown above."}</p></div>}
          {rows.map(token => <article key={token.mint} className="mb-3 rounded-xl border border-hairline/40 bg-card p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{token.name}</h3><p className="mt-1 text-xs text-accent-text">{token.symbol}{token.hasGithub ? " · GitHub" : ""}</p></div><div className="shrink-0 text-right"><p className="font-mono text-xs">{token.marketCapSol === null ? "—" : `${token.marketCapSol.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL`}</p><p className="mt-1 text-[10px] text-ink-secondary">launch market cap</p></div></div>
            {token.description && <p className="mt-3 line-clamp-2 break-words text-xs leading-relaxed text-ink-secondary">{token.description}</p>}
            <div className="mt-3 flex items-center gap-2"><code title={token.mint} className="min-w-0 flex-1 truncate text-[11px] text-ink-secondary">{token.mint}</code><button aria-label={`Copy mint for ${token.name}`} onClick={() => { void navigator.clipboard.writeText(token.mint).then(() => setNotice("Mint copied")).catch(() => setNotice("Copy unavailable. Select the mint address to copy it.")); }} className="rounded p-1 hover:bg-raised"><Copy size={13} /></button></div>
            <div className="mt-3 flex gap-4 text-xs"><a className="flex items-center gap-1 text-accent-text" href={`https://pump.fun/coin/${token.mint}`} target="_blank" rel="noopener noreferrer">Pump.fun <ArrowUpRight size={12} /></a><a className="text-ink-secondary" href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noopener noreferrer">Explorer ↗</a></div>
          </article>)}
        </div>
        <footer className="border-t border-hairline/40 px-5 py-3 text-[10px] leading-relaxed text-ink-secondary">Pump.fun relay · Launch snapshots, not current quotes.<br />{lastEvent ? `Last relay update ${new Date(lastEvent).toLocaleTimeString()}` : "No relay updates received yet."}</footer>
      </section>}
    </aside>
  );
}

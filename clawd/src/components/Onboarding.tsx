import { useEffect, useMemo, useState } from "react";
import { INTRO_BODY, INTRO_HEADING, PRODUCT_NAME } from "../../shared/product";
import {
  CONNECTORS,
  connectConnector,
  connectorStatus,
  type ConnectorConnectResult,
  type ConnectorId,
  type ConnectorStatus,
} from "../../shared/connectors";
import { setEmailGateDone, track } from "@/lib/analytics";
import { createIntroTapeClient, PUMP_TAPE_HTTP, type PumpLaunchMessage } from "@/lib/intro-tape";

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [statuses, setStatuses] = useState<ConnectorStatus[]>(() => CONNECTORS.map((row) => connectorStatus(row.id)));
  const [connectFlash, setConnectFlash] = useState<Record<string, ConnectorConnectResult>>({});
  const [walletName, setWalletName] = useState("Clawd");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [launches, setLaunches] = useState<PumpLaunchMessage[]>([]);
  const [tapeLive, setTapeLive] = useState(false);

  const tape = useMemo(() => {
    const client = createIntroTapeClient({
      onChange: () => {
        setTapeLive(true);
        setLaunches(client.recent());
      },
    });
    return client;
  }, []);

  useEffect(() => {
    track("onboarding_step", { step: "clawd-solana-intro" });
    tape.start();
    fetch("/api/connectors")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && Array.isArray(body.connectors)) setStatuses(body.connectors);
      })
      .catch(() => {});
    return () => tape.stop();
  }, [tape]);

  const onConnect = (id: ConnectorId) => {
    const result = connectConnector(id);
    setConnectFlash((current) => ({ ...current, [id]: result }));
    void fetch(`/api/connectors/${id}/connect`, { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && typeof body.id === "string") {
          setConnectFlash((current) => ({ ...current, [id]: body as ConnectorConnectResult }));
        }
      })
      .catch(() => {});
  };

  const onCreateWallet = () => {
    if (creating) return;
    setCreating(true);
    setWalletError(null);
    void fetch("/api/solana/wallets/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: walletName.trim() || "Clawd" }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { address?: string; error?: string } | null;
        if (!res.ok || typeof body?.address !== "string") {
          throw new Error(body?.error ?? "Could not reach the harness to create a wallet.");
        }
        setWalletAddress(body.address);
      })
      .catch((error: unknown) => {
        setWalletError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setCreating(false));
  };

  const enter = () => {
    track("onboarding_completed", { intro: "clawd-solana" });
    setEmailGateDone("submitted");
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-app p-6 text-ink">
      <div className="mx-auto grid min-h-full max-w-5xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <section className="rounded-2xl border border-hairline/40 bg-panel p-7">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}brand/clawd-icon.png`} alt="Clawd" width={56} height={56} className="shrink-0 object-contain" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Clawd 🦞 · Solana</p>
              <h1 className="text-[22px] font-semibold text-ink">{INTRO_HEADING}</h1>
            </div>
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">{INTRO_BODY}</p>

          <h2 className="mt-6 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-secondary">Connectors</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {statuses.map((row) => {
              const flash = connectFlash[row.id];
              const state = flash?.state ?? (row.configured ? (row.keyless ? "ready" : "connected") : "needs-key");
              return (
                <button
                  key={row.id}
                  type="button"
                  data-connector={row.id}
                  onClick={() => onConnect(row.id)}
                  className="rounded-xl border border-hairline/40 bg-card p-3 text-left hover:border-accent-border"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-medium text-ink">{row.label}</span>
                    <span className="text-[11px] text-accent">{state}</span>
                  </div>
                  <div className="mt-1 text-[12px] leading-snug text-ink-secondary">{row.tagline}</div>
                </button>
              );
            })}
          </div>

          <h2 className="mt-6 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-secondary">Local wallet</h2>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={walletName}
              onChange={(event) => setWalletName(event.target.value)}
              placeholder="Wallet name"
              aria-label="Wallet name"
              className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-secondary focus:border-accent-border focus:outline-none"
            />
            <button
              type="button"
              onClick={onCreateWallet}
              disabled={creating}
              className="rounded-lg bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-ink disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create wallet"}
            </button>
          </div>
          {walletAddress && (
            <p data-wallet-address={walletAddress} className="mt-2 break-all font-mono text-[13px] text-accent">
              {shortAddress(walletAddress)}
            </p>
          )}
          {walletError && (
            <p data-wallet-error className="mt-2 text-[12.5px] text-danger">
              {walletError}
            </p>
          )}

          <button
            type="button"
            onClick={enter}
            className="mt-6 w-full rounded-lg border border-accent-border bg-raised py-2.5 text-[15px] font-medium text-ink"
          >
            Enter {PRODUCT_NAME}
          </button>
        </section>

        <aside data-pump-tape className="flex max-h-[calc(100vh-3rem)] flex-col rounded-2xl border border-hairline/40 bg-panel p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Pump.fun tape</h2>
            <span className="text-[11px] text-accent">{tapeLive ? "live" : "listening"}</span>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-secondary">{PUMP_TAPE_HTTP}</p>
          <button type="button" onClick={() => window.dispatchEvent(new Event("clawd:open-pump-tokens"))} className="mt-3 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink">Explore Pump.fun tokens ↗</button>
          <button type="button" onClick={() => window.dispatchEvent(new Event("clawd:open-solana"))} className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-hairline/40 px-4 py-2 text-sm text-ink hover:bg-raised"><img src="./brand/solana/logomark.svg" alt="" className="size-4" />Open Solana mode</button>
          <ol className="mt-3 min-h-[220px] flex-1 space-y-2 overflow-y-auto [scrollbar-width:thin]">
            {launches.length === 0 ? (
              <li className="rounded-lg bg-card px-3 py-4 text-[13px] text-ink-secondary">Listening for launches…</li>
            ) : (
              launches.map((row) => (
                <li key={row.signature ?? row.mint ?? row.symbol} className="rounded-lg bg-card px-3 py-2">
                  <div className="text-[13px] font-medium text-ink">
                    {row.symbol ?? "???"} <span className="font-normal text-ink-secondary">{row.name ?? ""}</span>
                  </div>
                  {row.mint && <div className="font-mono text-[11px] text-accent">{shortAddress(row.mint)}</div>}
                </li>
              ))
            )}
          </ol>
        </aside>
      </div>
    </div>
  );
}

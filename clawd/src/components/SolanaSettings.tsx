import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Wallet } from "lucide-react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";

type SolanaCredentialName =
  | "heliusApiKey"
  | "phantomOrganizationId"
  | "phantomAppId"
  | "phantomApiPrivateKey"
  | "jupiterApiKey";

const CREDENTIALS: Array<{
  name: SolanaCredentialName;
  label: string;
  placeholder: string;
  body: (value: string) => unknown;
  flag: (config: ConfigStatus) => boolean;
}> = [
  {
    name: "heliusApiKey",
    label: "Helius API key",
    placeholder: "Paste a Helius key",
    body: (v) => ({ solana: { heliusApiKey: v } }),
    flag: (c) => c.solana?.heliusConfigured ?? false,
  },
  {
    name: "jupiterApiKey",
    label: "Jupiter API key",
    placeholder: "Optional — Jupiter works keyless",
    body: (v) => ({ solana: { jupiterApiKey: v } }),
    flag: (c) => c.solana?.jupiterConfigured ?? false,
  },
  {
    name: "phantomOrganizationId",
    label: "Phantom organization id",
    placeholder: "Optional org id",
    body: (v) => ({ solana: { phantomOrganizationId: v } }),
    flag: (c) => c.solana?.phantomConfigured ?? false,
  },
  {
    name: "phantomAppId",
    label: "Phantom app id",
    placeholder: "Optional app id",
    body: (v) => ({ solana: { phantomAppId: v } }),
    flag: (c) => c.solana?.phantomConfigured ?? false,
  },
  {
    name: "phantomApiPrivateKey",
    label: "Phantom API private key",
    placeholder: "Optional private key",
    body: (v) => ({ solana: { phantomApiPrivateKey: v } }),
    flag: (c) => c.solana?.phantomConfigured ?? false,
  },
];

function CredentialRow({
  name,
  label,
  placeholder,
  body,
  flag,
}: (typeof CREDENTIALS)[number]) {
  const { state, dispatch } = useStore();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = state.config ? flag(state.config) : false;
  const clearing = !value.trim() && configured;

  const save = () => {
    if (saving || (!value.trim() && !configured)) return;
    setSaving(true);
    setError(null);
    const request = window.ogb?.setCredential
      ? window.ogb.setCredential(name, value.trim())
      : api("/api/config", { method: "PUT", body: JSON.stringify(body(value.trim())) });
    request
      .then((status: ConfigStatus) => {
        dispatch({ type: "configStatus", config: status });
        setValue("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
        <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
        <span>{label}</span>
        {configured && <span className="text-[11px] text-success">Connected</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={configured ? "••••••••  (paste to replace)" : placeholder}
          aria-label={label}
          autoComplete="off"
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
        />
        <button
          onClick={save}
          disabled={saving || (!value.trim() && !configured)}
          className={cn(
            "flex w-[72px] shrink-0 items-center justify-center rounded-lg py-2 text-[13px]",
            clearing ? "bg-control text-danger hover:bg-raised-hover" : "bg-control text-ink hover:bg-raised-hover",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : clearing ? "Clear" : "Save"}
        </button>
      </div>
      {error && <div className="mt-1 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

type LocalWallet = { name: string; address: string; createdAt: string };
type PhantomWallet = { name: string; solanaAddress: string | null };
type AssetItem = { id?: string; content?: { metadata?: { name?: string; symbol?: string } }; token_info?: { balance?: number; symbol?: string } };

export function SolanaSettings() {
  const [wallets, setWallets] = useState<{ local: LocalWallet[]; phantom: PhantomWallet[] }>({ local: [], phantom: [] });
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [nativeSol, setNativeSol] = useState<number | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);

  const refreshWallets = useCallback(() => {
    setWalletError(null);
    void api("/api/solana/wallets")
      .then((body: { local?: LocalWallet[]; phantom?: PhantomWallet[] }) => {
        setWallets({ local: body.local ?? [], phantom: body.phantom ?? [] });
      })
      .catch((e: Error) => setWalletError(e.message));
  }, []);

  useEffect(() => {
    refreshWallets();
  }, [refreshWallets]);

  const generate = () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setWalletError(null);
    void api("/api/solana/wallets", { method: "POST", body: JSON.stringify({ name: trimmed }) })
      .then(() => {
        setName("");
        refreshWallets();
      })
      .catch((e: Error) => setWalletError(e.message))
      .finally(() => setCreating(false));
  };

  const loadAssets = () => {
    const address = owner.trim();
    if (!address || loadingAssets) return;
    setLoadingAssets(true);
    setAssetError(null);
    setAssets([]);
    setNativeSol(null);
    void api("/api/solana/assets", { method: "POST", body: JSON.stringify({ ownerAddress: address }) })
      .then((body: { items?: AssetItem[]; nativeBalance?: { lamports?: number } }) => {
        setAssets(Array.isArray(body.items) ? body.items : []);
        setNativeSol(typeof body.nativeBalance?.lamports === "number" ? body.nativeBalance.lamports / 1e9 : null);
      })
      .catch((e: Error) => setAssetError(e.message))
      .finally(() => setLoadingAssets(false));
  };

  const rows = [
    ...wallets.local.map((w) => ({ name: w.name, address: w.address, kind: "local" as const })),
    ...wallets.phantom.map((w) => ({ name: w.name, address: w.solanaAddress, kind: "phantom" as const })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {CREDENTIALS.map((credential) => (
          <CredentialRow key={credential.name} {...credential} />
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink">
          <Wallet size={14} />
          Local wallets
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-secondary">
          Secrets are sealed with OS-backed storage. Lists show public addresses only. Jupiter buys sign from these named local wallets, never Phantom.
        </p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
            placeholder="Wallet name"
            aria-label="New local wallet name"
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />
          <button
            onClick={generate}
            disabled={creating || !name.trim()}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Generate
          </button>
        </div>
        {walletError && <div role="alert" className="mt-1 text-[12px] text-danger">{walletError} <button className="underline" onClick={refreshWallets}>Retry</button></div>}
        <ul className="mt-3 flex flex-col gap-1.5">
          {rows.length === 0 && <li className="text-[12.5px] text-ink-secondary">No wallets yet.</li>}
          {rows.map((row) => (
            <li key={`${row.kind}-${row.name}`} className="rounded-lg bg-inset px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[13px] text-ink">
                <span>{row.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-ink-secondary">{row.kind}</span>
              </div>
              <div className="mt-0.5 break-all font-mono text-[11px] text-ink-secondary">{row.address ?? "no Solana address"}</div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-2 text-[13px] font-medium text-ink">Helius assets</div>
        <div className="flex gap-2">
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadAssets()}
            placeholder="Owner address"
            aria-label="Solana owner address"
            className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-hairline focus:outline-none"
          />
          <button
            onClick={loadAssets}
            disabled={loadingAssets || !owner.trim()}
            className="flex w-[72px] shrink-0 items-center justify-center rounded-lg bg-control text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingAssets ? <Loader2 size={13} className="animate-spin" /> : "Load"}
          </button>
        </div>
        {assetError && <div className="mt-1 text-[12px] text-danger">{assetError}</div>}
        {nativeSol != null && <div className="mt-2 text-[12.5px] text-ink-secondary">{nativeSol.toFixed(4)} SOL</div>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {assets.map((item, index) => {
            const meta = item.content?.metadata;
            return (
              <div key={item.id ?? index} className="rounded-lg bg-inset px-3 py-2">
                <div className="truncate text-[13px] text-ink">{meta?.name ?? item.token_info?.symbol ?? "Asset"}</div>
                <div className="truncate font-mono text-[11px] text-ink-secondary">{item.id ?? ""}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

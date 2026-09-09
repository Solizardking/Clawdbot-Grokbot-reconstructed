// Fresh-consumer import of the shipped Solana tool entry (not the unit-test file).
import { executeSolanaRoutedTool } from "../server/solana/solana-routed-tools.ts";

const emptyPort = {
  listWallets: async () => ({ wallets: [] }),
  listLocalWallets: async () => ({ wallets: [] }),
  getWalletAssets: async () => ({ items: [] }),
  getAsset: async () => ({}),
  searchAssets: async () => ({}),
};

const result = await executeSolanaRoutedTool(emptyPort, "solana_list_wallets", {});
const expected = { ok: true, count: 0, wallets: [] };
if (JSON.stringify(result) !== JSON.stringify(expected)) {
  console.error("unexpected empty-wallet shape", result);
  process.exit(1);
}
console.log(JSON.stringify(result));

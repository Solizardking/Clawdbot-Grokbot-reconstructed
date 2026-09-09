# Cheshire Trading Surfaces

Snapshot date: 2026-07-03.

## Constants

- `$CLAWD` mint: `8cHzQHUS2s2h8TzCmfqPKYiM4dSt4roa3n7MyRLApump`
- Public app: `https://cheshireterminal.ai`
- Public RPC route observed in bundle: `https://cheshireterminal.ai/api/solana/rpc`
- Jupiter plugin script observed in HTML: `https://plugin.jup.ag/plugin-v1.js`

## Current Trading Modules

- Spot/swap: `LiveSpotTradingTerminal`, `ClawdSwapWidget`, `ClawdBuyPanel`, `ClawdTokenAction`, `tokenChartData`.
- Market data and execution support: `dflow`, `tradeTracking`, `heliusService`, `useRecentTokens`, `TokenTicker`, `BurnTicker`.
- DFlow and OODA: `DFlowMarketsPage`, `DFlowOODAPage`.
- Perps: `PhoenixPerpsPage`, `ImperialDeskPage`, `birdeyePerps`.
- DEX and scanner: `DexPage`, `ContractExplorer`, `SearchInterface`, `WalletScannerPage`, `BackpackPage`, `TradingPage`.
- Launch/trend pages: `PumpPage`, `TrendingNews`, `NewsFeedPage`.

## Quote Fields To Show

- Input token and amount.
- Output token and estimated amount.
- Route and venue names.
- Price impact.
- Slippage tolerance.
- Minimum received or maximum spent.
- Network and priority fees.
- Quote timestamp/expiry.
- Any platform or treasury fee.

## Perps Preflight

Before live perps:

1. State market, side, notional, collateral, leverage, stop/take-profit if any, and liquidation risk.
2. Confirm the user understands live perps can lose collateral.
3. Run a simulation or paper order first when available.
4. Require explicit live-trade confirmation.

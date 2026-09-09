---
name: clawd-trading-terminal
description: Use or implement Cheshire Terminal trading surfaces for $CLAWD and Solana markets. Use when working on live spot trading, Jupiter swaps, DFlow markets, OODA trading flows, Phoenix perps, DEX/contract explorer, wallet scanner, Pump page, token tickers, or Clawd trading terminal workflows.
---

# Clawd Trading Terminal

Use this skill for trading UX, market data, and transaction preparation in Cheshire Terminal. Load `references/trading-surfaces.md` for current modules and route intent.

## Trading Workflow

1. Classify the task as read-only market intel, quote/simulation, order preparation, or submitted transaction.
2. For read-only work, choose the smallest reliable source: Solana RPC/Helius for accounts, Jupiter for quotes, DFlow/Phoenix specific APIs for their markets, or app APIs when the task is app-specific.
3. For quotes, show route, price impact, slippage, fees, expiry, and stale-data warning.
4. For orders, require wallet connection, typed confirmation, and post-submit signature verification.
5. For perps, default to paper/simulation unless the user explicitly requests live trading and confirms risk.

## Market Safety

- Never present a route or quote as executable after it expires.
- Never hide slippage, leverage, liquidation risk, platform fees, or priority fees.
- Never infer that a transaction landed from a front-end success toast; verify on-chain.
- Never combine multiple token actions into one user approval unless each action is itemized.

## $CLAWD Context

Use `8cHzQHUS2s2h8TzCmfqPKYiM4dSt4roa3n7MyRLApump` as the `$CLAWD` mint for token-specific terminal work. For deeper token ops, load the `clawd-token-ops` skill.

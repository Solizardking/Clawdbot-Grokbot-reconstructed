# $CLAWD Token Reference

Snapshot date: 2026-07-03.

## Addresses

- `$CLAWD` token mint: `8cHzQHUS2s2h8TzCmfqPKYiM4dSt4roa3n7MyRLApump`
- Treasury/payment address observed in Cheshire Terminal bundle: `HKBX8CwMGwnwtFjTH99xKa82whjowqxzsBQGWT3kBhDJ`

Address labels matter:

- Use the mint for token metadata, token accounts, balances, swaps, holder scans, and burn tracking.
- Use the treasury/payment address only for the specific payment gate flow after re-verification.

## Observed Cheshire Terminal Rules

- The app tracks `clawdBalance` as part of authenticated wallet state.
- The observed token-gate threshold is `100000` `$CLAWD`, with admin users bypassing normal balance gating.
- The app exposes holder, burn, staking, treasury, portfolio, buy panel, token action, and swap widgets.
- The app loads Jupiter plugin script `https://plugin.jup.ag/plugin-v1.js`.

## Quote And Swap Checklist

Before a swap or buy:

1. Re-verify the mint.
2. Fetch a fresh Jupiter quote.
3. Show input token, output token, estimated output, slippage, route, price impact, fees, and platform fees if any.
4. Ask the user to confirm the exact amount and wallet.
5. Submit only through the connected wallet.
6. Confirm the transaction signature on-chain.

## Burn Or Stake Checklist

Before burn or stake:

1. Show `$CLAWD` mint and connected wallet.
2. Show amount in base units and token units.
3. Explain whether the action is reversible.
4. Identify the program or destination.
5. Ask for explicit confirmation.
6. After submission, verify token account delta and signature.

---
name: paybox-pay-and-swap
description: Details for moving money with PayBox that the standing instructions do not carry — units, the checks to run before spending, and what a card authorization does not do. Use when asked to swap, bridge, send tokens, or pay a merchant.
license: MIT
---

# Moving money: the details that bite

Your standing instructions cover which tool to reach for and the Solana mint rule. This skill is the
part that is easy to get wrong.

## Before spending anything

`get_portfolio` first, and check the balance covers the amount **plus fees** — not just the amount.
Skipping it turns a clear "you need to grant the Solana wallet" into an opaque mid-flow failure.

## Amounts are in smallest units

`request_transfer` takes `amount` in wei, lamports, or the token's base units — never a decimal
figure. Omit `token` for the native asset; otherwise pass the ERC-20 contract (EVM) or SPL mint
(Solana).

## Read the recipient back

**A transfer moves real funds and cannot be undone.** Read the destination address back to the user
before they sign. This is the one mistake with no recovery, and confirming it costs a sentence.

## A card authorization is not a payment

`request_payment` authorizes a merchant-scoped, one-time virtual card. It does **not** submit
checkout or charge the merchant. On success, call `claim_payment_credentials` once if the card is
redacted, use it at the merchant, and only say paid after the **merchant** confirms — not when the
request reaches `success`.

## A swap can park more than one transaction

An `approve` before the `swap` is normal. The window handles both; do not treat the first as the
whole operation.

## Fiat funding is the user's step

`get_buy_link` returns a checkout URL. Share it — the user completes it themselves. Only say funds
arrived after a balance read confirms them; `verify_solana_balance` proves a specific transaction
landed without waiting for indexing.

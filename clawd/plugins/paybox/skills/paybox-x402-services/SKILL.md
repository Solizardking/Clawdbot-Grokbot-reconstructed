---
name: paybox-x402-services
description: Judgement for paying x402 services — which tool to reach for, why a listing fails, and telling the user the cost before spending it. Use when a task needs a paid API or an endpoint returns HTTP 402.
license: MIT
---

# Paying for services, without surprising the user

Your standing instructions cover the plugin contract flow (`discover_plugins` → `get_contract` →
`use_plugin`) and the World tool order. This skill is the x402 judgement around them.

## Which tool

- `use_service` — you want the result, and PayBox should handle the 402 round-trip
- `pay_x402` — the payment *is* the point, or you are driving the request yourself
- `mode="probe"` on `use_service` — one unpaid diagnostic request; proves nothing about paid success

## Cost before spending

x402 spends real money per call. **Tell the user what a service costs before paying**, and say so
before a loop: "I'll check five sources" can mean five payments. Quote `plan.x402.amount_usd`, which
is already in dollars — never convert the atomic amount yourself.

## A failing listing is usually the listing

The catalogue is large and unvetted. Many entries are dead, on unsupported rails, or return
non-compliant 402s. When one fails, **try a different service rather than retrying the same one** —
retrying spends again for the same reason.

## Read the contract, don't guess the schema

`get_contract` is what tells you a plugin tool's input shape. Guessing it is the usual cause of a
rejected `use_plugin` call. Same for a discovered service: follow its exact method, parameters, and
body rather than inferring from the summary.

## Partial success is a real outcome

At terminal `success` or `error`, inspect both `output.value.payment` and `output.value.resource`. If
`resource.ok=false`, check `payment.status` before telling the user anything — the payment may have
succeeded while the fetch failed. Do not retry blindly; another call may cost another payment.

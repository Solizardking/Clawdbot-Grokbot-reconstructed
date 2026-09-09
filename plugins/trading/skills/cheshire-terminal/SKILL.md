---
name: cheshire-terminal
description: Operate and extend Cheshire Terminal, the cheshireterminal.ai voice-controlled Solana terminal powered by $CLAWD. Use when working on voice terminal flows, token launch commands, LiveKit voice integration, Jupiter swap surfaces, burn/staking flows, or any task that mentions Cheshire Terminal, cheshireterminal.ai, $CLAWD terminal, or Clawd voice commands.
---

# Cheshire Terminal

Use this skill for product, code, or operations work around Cheshire Terminal. Keep wallet actions explicit, re-check live addresses before irreversible transactions, and route detailed constants through `references/current-site.md`.

## Operating Flow

1. Load `references/current-site.md` when the task needs current product routes, addresses, voice configuration, or page/module names.
2. Treat `https://cheshireterminal.ai` as the canonical public app.
3. Use the `$CLAWD` mint from the reference file for token-gated reads, balance checks, swap prefill, burn tracking, and docs.
4. Use LiveKit only through the configured public agent ID unless the user provides a different deployment.
5. Use Jupiter for swaps and quotes; never fabricate prices, routes, slippage, or transaction status.
6. Require explicit user confirmation before any wallet signature, token launch, swap, burn, stake, treasury payment, or mainnet write.

## Implementation Guidance

- Model terminal actions as commands with observable state: parsed intent, wallet status, quote or simulation, confirmation, signature, and post-check.
- Keep voice commands idempotent until the user confirms the final action.
- Prefer Solana mainnet reads through the app RPC route or a configured Helius/Jupiter endpoint.
- For token launches, collect name, symbol, description, image/art prompt, supply or curve settings, recipient wallet, and launch platform before generating a transaction.
- For burns or staking, display the mint, amount, wallet, destination program, and expected result before asking for approval.

## Safety Contract

- Never ask for private keys, seed phrases, wallet export files, or raw signing material.
- Never infer wallet ownership from a typed address alone; request wallet connection or a verifiable signature when ownership matters.
- Never execute a mainnet transaction from a voice transcript without restating the action in text and receiving confirmation.
- Label addresses clearly as token mint, treasury/payment address, program ID, or wallet address.

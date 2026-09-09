---
name: clawd-agent-launchpad
description: Build, launch, stake, and manage Clawd or Cheshire Terminal agents. Use when working on Agent Launchpad, agent templates, agent builder, agent hub, deployed agent detail pages, runtime matrix, Metaplex agent minting, staking, agent chat, or Clawd/Cheshire agent lifecycle tasks.
---

# Clawd Agent Launchpad

Use this skill for agent lifecycle work across Cheshire Terminal and Solana CLAWD. Load `references/agent-surfaces.md` when the task needs the current route/module map or launch checklist.

## Lifecycle Workflow

1. Define the agent purpose, owner wallet, runtime, model/provider, tools, memory policy, spend policy, and public profile.
2. If the agent will have an on-chain identity, decide whether it needs Metaplex agent minting before token launch or staking.
3. For templates, keep defaults safe: devnet or dry-run first, no autonomous spending, no mainnet launch without final confirmation.
4. For deployed agents, show runtime status, wallet, version, last action, policy limits, logs, and revoke/stop controls.
5. For staking or token-gated agent access, load `$CLAWD` data from `clawd-token-ops` or `references/agent-surfaces.md`.

## Build Guidance

- Treat every agent as a bounded actor with explicit permissions, spend caps, and tool allowlists.
- Store agent profile and runtime state separately from wallet signing material.
- Keep launch actions auditable: proposed config, simulation or dry-run output, confirmation, transaction signature, and post-launch verification.
- For chat UX, show which agent is speaking, which tools were used, and what actions require wallet approval.
- For arenas or leaderboards, separate entertainment scores from financial performance.

## Non-Negotiables

- Do not give an agent unlimited wallet authority.
- Do not launch a token, bind a token to an agent, stake, or register identity on mainnet without explicit confirmation.
- Do not persist private keys, seed phrases, or raw wallet signatures in agent memory.

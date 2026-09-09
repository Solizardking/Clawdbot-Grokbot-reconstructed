# Clawd Bot model routing and cloud computers

These guides describe Clawd Bot's optional hop integration and the OpenGrok
reference it was adapted from. The `docs/opengrok/` path is retained for existing
links. OpenGrok remains the reference project's name, not Clawd Bot's product name.

Clawd Bot runs its standalone desktop workspace from [`clawd/`](../../clawd/README.md).
The parent runtime provides the optional hop installer described here.

| Integration | Configuration / role |
| --- | --- |
| E2B desktop | `E2B_API_KEY`; isolated computer tools (`e2b_computer_*`) |
| Browser Use | `BROWSER_USE_API_KEY` / `BROWSERUSE_API_KEY`; separate hosted browser tools |
| Helius | `HELIUS_RPC_URL`; Solana RPC and indexed asset operations |
| Clawd Gateway | `CLAWD_GATEWAY_URL`; optional quote integration |

For hosted access, operator provider keys stay on the gateway; clients use
account tokens and service grants. See [Fly hosting](../FLY-HOSTING.md).

- [Box integration](BOX-INTEGRATION.md): files available here and installation boundaries.
- [Cloud host routing](CLOUD-HOST.md): distinguish installation from a routed turn.
- [Provider choice](BYOK-DECISION.md): native engines, hosted access, and optional hops.
- [Model guidelines](MODEL-GUIDELINES.md): request controls and validation.
- [Codex Everywhere reference](CODEX-EVERYWHERE.md): external adapter requirements.
- [Testing](TESTING.md), [failure modes](FAILURE-MODES.md), and [roadmap](ROADMAP.md).

Commands use the parent repository root unless explicitly marked as reference-only.
Legacy `GROKBOT_*`, `.grokbot`, and `/home/box/sand-data/` names remain runtime
contracts. Renaming them in documentation would produce invalid configuration.

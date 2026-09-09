# Notice

This repository is an unofficial reconstruction derived from a publicly
distributed binary application. It is not affiliated with or endorsed by
Anysphere, Cursor, xAI, or SpaceX.

No upstream source-code license is asserted or granted here. The absence of the
original binary payload and recovery evidence from Git does not by itself make
the reconstructed implementation safe to redistribute. Anyone publishing or
distributing this repository should independently review copyright, trademark,
third-party dependency, and service-terms obligations.

The repository preserves pinned Grok Bot 0.18.0 macOS and Windows installers
through Git LFS for research continuity. Those artifacts remain subject to their
own terms and are not covered by any license applied to reconstructed code.

## PayBox integration

The bundled `plugins/paybox/skills` and connector metadata originate from the
user-supplied PayBox plugin, copyright (c) 2026 MoonPay, licensed under MIT.
The full license is retained at `plugins/paybox/LICENSE`. Runtime instructions
embed the three skill texts. The runtime also depends on `@paybox-sh/sdk`
(version 0.8.5); its distributed license remains with the installed package.

The bundled `plugins/trading/skills` folders (and their support files) are
copied from the local go-bot skill library. Each skill keeps the license in
its own `SKILL.md` or `LICENSE` when present.

Solana address and private-key decoding follow Trust Wallet Core's Solana
`Address` and `Entry` (Apache-2.0).

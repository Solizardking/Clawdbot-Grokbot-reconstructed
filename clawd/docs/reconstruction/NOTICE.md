# Clawd Bot imported-material notice

This notice applies to reconstruction-derived material imported into Clawd Bot,
including the source and integration files identified in `imported-files.json`.
That material originated in an unofficial reconstruction of a publicly
distributed binary application. It is not affiliated with or endorsed by
Anysphere, Cursor, xAI, or SpaceX.

No upstream source-code license is asserted or granted here. The absence of the
original binary payload and recovery evidence from Git does not by itself make
the reconstructed implementation safe to redistribute. Anyone publishing or
distributing this repository should independently review copyright, trademark,
third-party dependency, and service-terms obligations.

The parent reconstruction recorded pinned Grok Bot 0.18.0 macOS and Windows
installers for research continuity. Those installers are not part of this
standalone Clawd Bot source export. Their identities remain in
[PROVENANCE.md](PROVENANCE.md); no license to those artifacts is granted here.

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

## Application scope

Clawd Bot application attribution is recorded in [the root NOTICE](../../NOTICE).
Its Apache-2.0 license does not grant additional rights to the separately
identified reconstruction material. Historical workspace and lock files in this
directory are evidence, not installation inputs. See [the directory guide](README.md).

# Clawd Bot animated pet

The Clawd pet is the original neon voxel lobster credited to @clawddevs,
imported from the supplied SOL-GPT `clawd-setup` package.

| File | Purpose |
| --- | --- |
| `pet.json` | Stable pet identity, display name, version, and spritesheet path. |
| `spritesheet.webp` | Version 1 animation atlas, 1536 × 1872 pixels. |
| `clawd-codex.zip` | Portable Codex pet package supplied with the atlas. |

The atlas has eight columns and nine rows of 192 × 208 pixel cells.
Populated frame counts by row are 6, 8, 8, 4, 5, 8, 6, 6, 6. Preserve this
layout when changing artwork unless the animation consumer changes too.

Vite copies this directory to `dist-ui/pets/clawd/`. Edit the source here and
run `npm run build:ui` from the Clawd Bot root. Keep the package and manifest
consistent with the spritesheet; do not rename IDs merely to change visible
branding. These are runtime animation assets, not screenshots of a release.

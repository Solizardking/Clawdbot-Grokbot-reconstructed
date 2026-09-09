# Prepare Clawd Bot for source publication

Clawd Bot is a standalone npm workspace. Its renderer, harness, Electron shell, companion, and imported integrations must install and build without the parent reconstruction directory.

## Source boundary

| Material | Treatment |
| --- | --- |
| `src/`, `server/`, `electron/`, `companion/`, `ios/` | Editable Clawd Bot application sources. |
| `box/`, `deploy/`, `plugins/`, `services/`, `source/`, `tests/`, `tools/` | Included integration sources and required support files. |
| `public/`, authored `build/` resources | Included branding and native packaging inputs. |
| `docs/reconstruction/` | Separate provenance, notices, imported-file inventory, and historical pnpm records. |
| `node_modules/`, generated `dist-*`, release artifacts, caches | Generated locally; excluded from source publication. |
| Runtime `.env`, Worker `.dev.vars`, keys and private credentials | Excluded. Use example configuration with placeholders. |
| Parent installers, recovered renderer, forensic tools | Not dependencies of this standalone application. |

The standalone Clawd Bot remote is `Solizardking/clawd-bots`. The parent reconstruction remote is `Solizardking/grok-bot-0.18-reconstructed`. The original `b-nnett/grok-bot-0.18-reconstructed` repository is archived and read-only. A remote URL is an address, not proof that the latest local changes were pushed or passed CI.

Current product captures for README and docs live in [screenshots](screenshots/README.md). Do not publish `node_modules/`, generated `dist-*`, `.cache/`, runtime `.env`, or Worker `.dev.vars`.

## Check and export

From the Clawd Bot repository root, use the runtime pinned in `.node-version`:

```sh
npm ci
npm run publication:check
npm run publication:export
```

The exporter writes a source snapshot under `publication/clawd` by default. Check its printed output before using the destination. Install and validate the export independently of the parent tree; follow [validation](validation.md).

The scanner checks publishable files for excluded paths, external symlinks, large blobs, and selected credential patterns. It is not a complete secret scanner or a license review. Imported integration material retains its own [notice](reconstruction/NOTICE.md) and [provenance](reconstruction/PROVENANCE.md).

## Existing history

An earlier import audit recorded a tracked private Worker configuration. Removing it from the current tree does not remove old commits or other clones. Previously exposed credentials require rotation. A source export omits `.git` history; it does not sanitize, rewrite, or force-push the existing repository.

Before publishing an existing history, review that history separately. Source publication, signed desktop distribution, and live provider connectivity are separate checks. See [releasing](releasing.md) for the desktop boundary.

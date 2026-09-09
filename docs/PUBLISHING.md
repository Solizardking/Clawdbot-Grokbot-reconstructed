# Publishing Clawd Bot

Publish the standalone app from `clawd/`. Its source export and package checks
are separate from the parent runtime's historical clean-branch export.

## Standalone Clawd Bot source

Run from `clawd/`:

```sh
npm run publication:check
npm run publication:export -- /path/to/new-clawd-bot-export
```

Use a destination that does not exist. The export copies publishable working-tree
sources without Git history; it is not a build, release upload, or notarization.
Review the exported files and retained notices before initializing a new repository.
See the [Clawd Bot publication guide](../clawd/README.md#github-publication)
and [validation notes](../clawd/docs/validation.md) for application checks.

Use **Clawd Bot** for release titles and product copy. Preserve third-party
names in provenance, license notices, provider IDs, and compatibility settings.
Use the [documentation assets](assets/README.md) for illustrations; do not present
a routing diagram as a screenshot or evidence of a working deployment.

## Parent runtime export

The `codex/clean` branch removes generated recovery material from its tree, but
its parent commit still contains that material. Do not push the branch and
assume the deleted files are absent from Git history.

Create a new repository from an archive of the clean commit:

```sh
git archive --format=tar codex/clean | tar -xf - -C /path/to/empty-export
cd /path/to/empty-export
git init
git add .
git commit -m "Initial Clawd Bot parent runtime source import"
```

The preserved installers use Git LFS. Install LFS before the initial `git add`,
then push the objects after adding the remote:

```sh
git lfs install
git add .
git commit -m "Initial Clawd Bot parent runtime source import"
git push -u origin main
git lfs push --all origin
```

If the hosting service offers downloadable source archives, enable its option
to include Git LFS objects in those archives; otherwise generated ZIP/tarball
downloads may contain only LFS pointer files.

Before adding a public remote:

1. Run `npm run publication:check` on the committed clean branch. It performs
   the archive/init/add flow above and requires the new index to have the exact
   same Git tree.
2. Run `npm ci`, `npm run bootstrap`, `npm run check`, `npm run package`, and
   `npm run verify` from a fresh clone/export.
3. Confirm `git status --ignored` shows no generated payload selected for Git.
4. Run `git lfs ls-files` and verify both preserved 0.18.0 installers appear.
5. Scan the exported tree and full new history for credentials and absolute
   machine paths.
6. Review `NOTICE.md` and obtain an independent rights review. No upstream
   license is supplied by this repository.
7. Decide on a license only for material you have authority to license; do not
   imply that license covers the upstream application or trademarks.

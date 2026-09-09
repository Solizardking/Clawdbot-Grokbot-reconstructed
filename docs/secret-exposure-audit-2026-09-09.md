# Secret exposure audit — September 9, 2026

## Confirmed issue

Credentials were committed in `deploy/openrouter.env` and
`clawd/cloudflare/control-plane/.dev.vars`. The files are now untracked and
ignored; local copies are preserved with mode `0600`. Earlier commits still
contain their values. `.env.local` was not tracked and remains mode `0600`.

**Do not publish the existing history until affected credentials have been
rotated/revoked and the history has been cleaned.** No credentials were rotated,
no history was rewritten, and no push or deployment was performed by this audit.
History rewriting is awaiting the owner's approval.

## Protections applied

- Ignore rules cover nested environment files, private keys, and common local
  credential stores. Docker contexts exclude private configuration; Telegram
  service contexts allow only the files their Dockerfiles need.
- Local backup applications and generated native binaries were removed from Git
  tracking without deleting their disk copies.
- Nine private environment/configuration files use mode `0600`. The Git
  directory uses mode `0700` because it still contains historical credentials.
- `npm run security:check` checks staged blobs, working files, and unignored new
  files using local credential values and common token/private-key patterns.
  It is wired into CI, `check`, deployment, and publication checks.
- Package preparation now checks both root and Clawd `.env.local` values.
- The installed pre-push hook runs the repository guard before the original Git
  LFS hook. Its history check rejects the two historical private paths. The
  original hook is preserved at `.git/hooks/pre-push.before-secret-audit`.

## Verification

- Current tracked/index/working-file credential scan passed with no findings.
- Five focused security tests passed, including stale staged secrets, untracked
  copies, redacted scanner output, and desktop/hosted secret boundaries.
- The build/publication/application scan covered 11,802 files without a match
  to the configured local secrets.
- Decompressed npm and ZIP archives contained no detected credentials or private
  configuration filenames. Duplicate archive copies were compared by SHA-256.
- The three private-key-format findings in bundled cloudflared executables match
  Cloudflare's public sample hello-server key exactly; see
  [upstream source](https://github.com/cloudflare/cloudflared/blob/master/tlsconfig/hello_ca.go).
  That exact sample is exempted by hash, without exempting entire binaries.
- Oversized artifact results are recorded separately in the local report folder.

## Remaining work and limits

The owner must rotate/revoke the committed privileged credentials and approve
history cleanup. The local redacted inventory is
`.cache/security-audit/rotation-inventory.json`; it contains variable names,
not values. Aliases and public identifiers need individual review.

Origin advertised only `main`, at `a9f633e09d49a85829b8236331b9e21f7e612634`, when
checked. The commits introducing the two private files were not ancestors of
that ref. This does not establish whether credentials were published earlier,
copied elsewhere, logged by providers, or exposed by existing deployments.

The scanner checks known local values and selected formats. It cannot prove the
absence of every possible encoded or unknown secret. The history guard detects
private filenames; it does not scan every historical blob's contents. Keep
release review and provider-side rotation as separate requirements.

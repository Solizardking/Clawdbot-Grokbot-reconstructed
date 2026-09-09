# Clawd Bot plan: isolate Windows permission-broker test pipes

Historical regression plan from August 18, 2026, associated with upstream PR 230. The observed Windows failure was a test-fixture pipe collision. Recheck current fixtures before changing production socket behavior.

## Diagnosis

The four test thread IDs `t-perm-dup-1` through `t-perm-dup-4` truncated to the same eight-character tag, `t-perm-d`. A pipe still owned by the preceding test caused the next listener to fail with `EADDRINUSE`; its subsequent client connection reported `ENOENT`.

POSIX unlink behavior can hide this naming problem. A Windows named pipe is not a filesystem socket that `unlinkSync` can remove. Retrying the client connection cannot start a broker whose listener failed.

## Planned change

Use `t-dup-1`, `t-dup-2`, `t-dup-3`, and `t-dup-4` consistently throughout the four collision tests. Keep their request IDs and behavior assertions unchanged. Add a platform-independent assertion that mapping these thread IDs through `permissionSocketPath` yields four distinct names.

This is a test-only scope. Do not modify production tag truncation, add timing sleeps, or weaken collision assertions to make the test pass. Short production tags remain a separate design concern, not something proven collision-free by real UUID usage.

## Acceptance

The four tests must still verify explicit duplicate denial, one actionable request for the live ID, resolution of the original request, and acceptance of post-resolution reuse.

```sh
npx vitest run server/drivers/claude.test.ts
npm run typecheck
npm test
```

Run from the Clawd Bot root. Require the deterministic uniqueness assertion plus a real Windows run. The historical acceptance gate called for two consecutive green Windows runs because the failure was timing-dependent. The current checked-in CI is Ubuntu-based, so record Windows evidence separately; a local macOS pass does not meet that gate.

## Deferred work

Fail-fast rejection of test answer waiters after socket error/close needs a scenario that kills a live broker. Production socket naming and Windows release behavior also need independent justification and tests. Neither should be slipped into this fixture repair.

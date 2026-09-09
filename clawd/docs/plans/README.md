# Planning archive

These plans retain historical implementation steps, upstream issue numbers and pnpm commands. They are not setup scripts or a claim that every proposal is shipped. Use `npm exec -- vitest run …` for historical `pnpm vitest run …` commands, and `npm run <script>` only when that script exists in the current manifest.

| Plan | Current implementation / verification |
| --- | --- |
| [Claude teardown](2026-08-18-001-fix-claude-turn-teardown-zombie-cards-plan.md) | [Claude driver tests](../../server/drivers/claude.test.ts) cover teardown and late permissions. |
| [Permission collisions](2026-08-18-001-fix-permission-broker-ask-id-collision-plan.md) | Same driver tests cover broker ID collisions. |
| [Windows pipe tests](2026-08-18-002-fix-windows-pipe-name-collision-in-collision-tests-plan.md) | Windows behavior requires a Windows test run. |
| [Harness upgrades](agent-harness-upgrades.md) | Historical proposal; assess individual features against current source. |
| [Harness upgrades v2](agent-harness-upgrades-v2.md) | [Turn context](../../server/turn-context.test.ts), [branching](../../server/branching.test.ts) and [checkpoints](../../server/checkpoints.test.ts) provide current contracts. Deferred items remain proposals. |
| [OpenCode plan](opencode-go-integration.md) | Superseded setup/catalog details: use [OpenCode](../opencode-go.md). |

See also [Superpowers records](../superpowers/README.md). Do not execute archived agent workflow directives as installation steps.

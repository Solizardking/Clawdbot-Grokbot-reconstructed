# Clawd Bot implementation checklist: OpenCode ACP

Historical task plan dated August 15, 2026. It is retained as an engineering checklist, not an instruction to create already-existing files or execute another workflow. The original Go-only catalog/key assumptions were superseded by the general OpenCode adapter.

Read [the updated integration plan](../../plans/opencode-go-integration.md), [current user guide](../../opencode-go.md), and [design contract](../specs/2026-08-15-opencode-go-integration-design.md) together.

## Work units

| Unit | Source boundary | Evidence required for a change |
| --- | --- | --- |
| Dynamic models | `server/drivers/acp/core.ts` | Refresh without recreating unrelated engines; static supports still work. |
| OpenCode adapter | `server/drivers/acp/opencode-go.ts` | Configured CLI discovery, validated exact IDs, cache/fallback, availability. |
| Credentials | `server/config.ts`, `server/index.ts` | Write-only public status and child-scoped environment; explicit local injection behavior. |
| Registration and UI | `server/drivers/builtIn.ts`, `src/components/` | Saved `opencodeGo` compatibility, OpenCode label, optional setup and accurate availability. |
| Protocol | `server/testing/fake-acp-cli.ts`, ACP tests | Initialize, new/load session, select model, prompt, stream, permission, cancel, cleanup. |
| Documentation | `docs/opencode-go.md` | Current CLI-based catalog and auth behavior, without fixed subscription/model promises. |

## Verification order

Reproduce a concrete gap before changing runtime code. Add a focused behavioral regression when needed, implement the smallest correction, and run the neighboring ACP tests. Verify credentials are absent from public payloads and logs using synthetic test values.

```sh
npx vitest run server/drivers/acp/opencode-go.test.ts server/drivers/acp/acp.test.ts
npm run typecheck
npm test
npm run build
npm run check:electron
```

Run from the Clawd Bot root. Live smoke is a separate, account-dependent check; report the CLI version, selected model, actual response, approval, resume, and cancellation results. Do not mark this entire checklist complete merely because a catalog refresh succeeded.

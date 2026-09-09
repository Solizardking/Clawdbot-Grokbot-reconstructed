# Use Cursor with Clawd Bot

Cursor is an optional engine. Clawd Bot launches `cursor-agent acp` and uses the shared ACP runtime for sessions, streaming, tools, approvals, resume, and cancellation. Cursor owns authentication and model access.

## Setup

Install the CLI using the [official Cursor CLI guide](https://cursor.com/docs/cli/overview). This checkout defaults to the executable name `cursor-agent`; confirm that executable is available to the configured instance even if the upstream guide also uses the shorter `agent` command.

```sh
cursor-agent --version
cursor-agent login
cursor-agent models
```

Alternatively, configure `CURSOR_API_KEY` or `CURSOR_AUTH_TOKEN` in the instance environment. Restart Clawd Bot after installation or login. GUI discovery includes common CLI locations such as `~/.local/bin`; a missing binary or login should appear as an availability problem for that engine.

## Model selection

The adapter merges discovered models with a static fallback catalog and retains a usable catalog if discovery fails. A model in the picker is not proof that the signed-in account can use it.

Clawd Bot passes `--model <slug>` before `acp`. When ACP supports `session/set_model`, the adapter maps the selected slug to an advertised ACP ID. These namespaces can differ: `auto` may map to `default[]`, and a model slug may map to an ID containing reasoning parameters. If the method is unsupported, the argv selection remains the fallback.

## Permissions and limitations

Instance `fullAuto: true` adds `--force`. ACP permission requests still pass through Clawd Bot's permission handling; automatic mode chooses an offered allow option when available.

Cursor-specific extension methods do not all have dedicated Clawd Bot UI. Unknown JSON-RPC requests receive method-not-found rather than hanging. MCP availability depends on the installed CLI's ACP support; inspect its project or user configuration when a tool is missing.

## Verify an integration change

From the Clawd Bot repository root:

```sh
npx vitest run server/drivers/acp/cursor.test.ts server/drivers/acp/acp.test.ts
```

For live validation, use a signed-in CLI and verify a reply, the selected model, a tool approval, resume, and cancellation. Record the CLI version and outcome without credentials or raw credentialed protocol logs. Implementation: [Cursor adapter](../server/drivers/acp/cursor.ts).

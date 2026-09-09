# Clawd Bot model integration guidelines

![Clawd Bot model routing](../assets/project-flow.svg)

A working integration needs a selected route, valid authentication, the correct
provider request shape, and an observable completed conversation. Model names
alone do not establish compatibility.

## Select the implementation

Use Clawd Bot's native engine or hosted gateway when it supports the provider.
The optional imported hop uses `box/openai-hop-session.cjs` and
`tools/provider-maps.cjs` in the parent repository. A per-agent binding is only
effective when a compatible host consumes it; see [cloud-host routing](CLOUD-HOST.md).

Provider names such as xAI Grok, OpenRouter, NVIDIA, and Codex are third-party
identifiers. Preserve exact model IDs, request fields, and protocol labels.
They must not be renamed to Clawd Bot.

## Request controls

- Verify the exact upstream model ID and endpoint for the configured route.
- Check reasoning controls against the implemented provider map. Do not assume
  a universal effort suffix or thinking toggle across model families.
- Preserve explicit caller budgets; bound defaults and retries.
- Test streaming text, tool arguments, tool results, usage, and provider errors.
- Keep summarization bounded and account for shared capacity.
- Report unsupported controls and unavailable routes visibly.

The imported map exposes `applyProviderReasoningControls(body, ctx)`. Inspect
its route matchers before adding a model; historical OpenGrok wire captures
are evidence for their recorded model/version, not all current providers.

## Credentials and state

Bindings carry route metadata, never provider secrets. Use the engine's secret
store or a server-held credential. Hosted clients receive revocable gateway
access. Keep authorization headers, credential-bearing URLs, and full request
bodies out of logs and public docs.

`GROKBOT_*`, `.grokbot`, and `sand-data` names in the imported executor are
compatibility contracts. Product copy uses Clawd Bot; runtime renaming requires
a separate migration with matching code changes.

## Validate and maintain

Start with syntax checks and local regression tests. Use fake upstreams for
request-shape and error-path checks. When live verification is authorized,
correlate a normal app conversation with the selected provider, then verify a
required tool round trip. A model catalog or successful direct request is not
proof of desktop routing.

Record the app build, model ID, time, and outcome without secrets. After an
update, check host compatibility and reviewed hashes before reapplying patches.
Upstream doctor/picker scripts are not bundled here and do not provide automatic
update protection for Clawd Bot.

See [testing](TESTING.md) and [failure modes](FAILURE-MODES.md).

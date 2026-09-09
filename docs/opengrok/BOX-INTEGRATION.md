# Clawd Bot box integration

The parent runtime includes `box/openai-hop-session.cjs`, `tools/provider-maps.cjs`,
and `tools/file-relay.py`. These support an optional OpenAI-compatible hop on an
E2B desktop. They do not replace Clawd Bot's native engine configuration.

## Inspect and install

Run from the parent repository root:

```sh
node --check box/openai-hop-session.cjs
node --check tools/provider-maps.cjs
```

`cloud_box_doctor` reports configured computer providers. With hosted access,
`cloud_box_install_hop` creates or uses the account's desktop, provisions Node,
and copies the executor and provider map with checksum verification. The
installer returns the Node path and reports `consumerInstalled: false`.
See [hosted installation evidence](../FLY-HOSTING.md#hosted-hop-installation).

Use the files from the reviewed checkout. The upstream OpenGrok download and
98-check harness described in older notes are not a Clawd Bot installation
command or a test count for this repository; `box/test/` is not bundled here.

## Runtime configuration

These names are retained by the imported executor:

| Variable | Purpose |
| --- | --- |
| `GROKBOT_HOP_BRIEFING` | Optional inline specialist briefing |
| `GROKBOT_HOP_BRIEFING_FILE` | Optional briefing file |
| `GROKBOT_LIVE_METRICS_LOG` | Per-turn metrics output path |
| `GROKBOT_STATE_DIR` | State directory used by the executor |
| `GROKBOT_METRICS_RELAY` | Optional private metrics relay |
| `GROKBOT_LOCAL_PROVENANCE_LOG` | Provenance audit output path |

They are compatibility identifiers, not Clawd Bot display names. Existing
`.grokbot` and `/home/box/sand-data/` paths must match the installed executor.

## Verify routing

A successful transfer or module load proves installation only. A host must read
the conversation binding and pass its route into the hop executor. Confirm a
normal Clawd Bot conversation reaches that route and completes a tool round trip
before reporting working integration. See [cloud-host routing](CLOUD-HOST.md).

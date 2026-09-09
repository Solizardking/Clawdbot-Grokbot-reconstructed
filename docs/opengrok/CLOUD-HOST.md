# Clawd Bot cloud-host routing

Installing a hop executor or saving `model-bindings.json` does not prove a
Clawd Bot conversation uses it. Routing requires a host consumer that reads the
binding at model resolution and passes the selected URL, model, and controls to
the executor.

## Available here

The parent runtime includes the hop executor, provider map, file relay, and
hosted installer. The installer explicitly reports `consumerInstalled: false`.
The upstream OpenGrok `setup.py`, `model-picker.py`, and `apply-box-patch.py`
workflow is reference-only; those programs are not bundled in this checkout.
Do not apply an unreviewed patch to a different host build.

The reference host uses `/home/box/sand-host/host-main.cjs` and stores bindings
in `/home/box/sand-data/model-bindings.json`. These are compatibility paths,
not a claim that Clawd Bot's standalone server uses that layout.

## File relay

The supplied relay transfers files; it does not consume model bindings:

```sh
python3 tools/file-relay.py --dir /home/box/sand-data --port 8799
```

Run this on the intended box with the repository files available. Keep access
private. `/push/<name>` writes a file and `/pull/<name>` reads it; successful
transfer alone cannot activate a model route.

## Integration states

| State | Required evidence |
| --- | --- |
| Saved locally | Binding file contains the intended agent and exact model ID |
| Copied to box | Destination bytes match the reviewed local files |
| Consumer installed | Compatible host reads the binding and forwards route controls |
| Routed turn | A normal conversation reaches the intended hop and returns a persisted answer |
| Tool execution | The same route completes a tool call and returns the result to the conversation |

Use timestamps or request IDs to correlate a normal turn with hop activity.
A direct provider probe checks provider access, not host routing. Do not log
credentials or full conversation bodies as routing evidence.

For the supported hosted-provider path, follow [Fly hosting](../FLY-HOSTING.md).
Remote turns and native tool completion have their own documented limits.

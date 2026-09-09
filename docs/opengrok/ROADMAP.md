# Clawd Bot routing roadmap

This roadmap tracks integration boundaries for Clawd Bot. The historical
OpenGrok setup and update-survival promises are not release guarantees here.

## Available in the source tree

- Standalone Clawd Bot application under `clawd/`, with its own build and checks.
- Shared hosted-provider gateway with account tokens and service grants.
- Parent runtime hop executor, provider map, file relay, and hosted installer.
- Dated deployment and verification records in [Fly hosting](../FLY-HOSTING.md).

## Remaining integration work

- Install and verify a compatible host binding consumer for the optional hop.
- Prove a normal routed conversation and required tool calls for each target host.
- Add provider controls only with request-shape and failure-path evidence.
- Recheck compatibility after host, model, or protocol changes.
- Complete outstanding provider and release checks recorded in
  [hosted infrastructure](../clawd-infrastructure.md).

A copied artifact, healthy process, or successful model listing does not close
a conversation or tool-execution requirement. Keep unavailable behavior visible
and retain exact provider IDs and compatibility fields.

# PayBox integration

The three skills and MIT license are copied from the supplied local
`clawd-router/paybox-plugin` snapshot. Runtime instructions embed those skill
texts. `.mcp.json` is reference connector configuration; the app uses its own
HTTP MCP adapter and `@paybox-sh/sdk` pinned to 0.8.5.

Run `npm run paybox:login` from the repository. `npm run paybox:status` reports
local login and signing configuration, not server reachability. Ask the bot
for `paybox_status` to inspect runtime status; granted tools appear after
successful server discovery. Set `PAYBOX_ENABLED=0` to disable discovery.

Save a scoped signing key in the masked desktop PayBox field or supply
`PAYBOX_SIGNING_KEY`. Do not paste keys into conversations. An existing local
OAuth login is reused and refreshed. `PAYBOX_API_KEY` or `PAYBOX_ACCESS_TOKEN`
can replace it. Hosted runtimes must receive their own credentials. Separate
`PAYBOX_CONFIG_DIR` directories should be used for independent deployments;
do not run the PayBox CLI concurrently against the same rotating OAuth login.

The adapter supports dynamic discovery, request status polling, unpaid probes,
and PayBox SDK signing for supported swap, wallet-sign, x402 v1, and simple
service requests. Advanced MCP tools preserve server approval flows; the
reconstructed desktop does not embed PayBox's browser signing window. Open
returned approval links in PayBox when needed. A granted wallet may still lack
a usable signer. Pending requests must be polled, never treated as success or
resubmitted to try another model. No payment is made during installation/tests.

See the bundled skills for balance/fee checks, atomic units, recipient readback,
card authorization versus merchant payment, and x402 partial-success handling.

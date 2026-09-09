# Private desktop runtime

This is the reconstructed host and box exec daemon packaged for Linux. Each
user requires a separate Fly app, private network, and data volume. Operator API
keys stay on `services/provider-gateway`; the runtime receives only its user's
gateway token. Never assign one runtime to multiple users.

Build and stage the Linux runtime directly from source (no macOS app rebuild required):

```sh
node services/desktop-runtime/stage.mjs --build
fly apps create YOUR_RUNTIME_APP --org personal --network YOUR_USER_NETWORK
fly ips allocate-v6 --private --app YOUR_RUNTIME_APP
fly volumes create runtime_data --app YOUR_RUNTIME_APP --region iad --size 1
node services/desktop-runtime/import-access.mjs YOUR_RUNTIME_APP /private/client.env
cd services/desktop-runtime
fly deploy --app YOUR_RUNTIME_APP --ha=false --no-public-ips --remote-only --depot=true
```

If you already ran `npm run package` against the current source, `stage.mjs` without
`--build` can reuse those verified bundles. Both paths copy only the host/daemon
bundles and an inventory; operator credentials are never part of the image.

After the runtime passes its Fly health check, assign it from the repository root:

```sh
node services/provider-gateway/assign-runtime.mjs YOUR_GATEWAY_APP /private/client.env YOUR_RUNTIME_APP /private/current-policy.json
npm run gateway:deploy
node services/desktop-runtime/smoke.mjs /private/client.env
node services/desktop-runtime/smoke-services.mjs /private/client.env
```

The assignment command merges into the live registry and stages the updated
secret; it preserves other users and their limits. The gateway forwards authenticated
host requests to `http://YOUR_RUNTIME_APP.flycast`. The private ingress address
above is on the organization's default network, where this gateway runs. For a
gateway on a named custom network, add `--network YOUR_GATEWAY_NETWORK` to the
allocation command. Keep runtime apps without public IPs and `force_https = false`
(Flycast uses HTTP within Fly's private network). The public gateway enforces HTTPS.
Each new request checks the gateway registry. A revoked token fails new runtime requests;
close existing streams and stop the user's runtime when immediately terminating
access. Token rotation also requires updating the runtime's two token secrets.

The gateway currently limits runtime request bodies to 1 MB. Larger attachment uploads require
a separate upload path and are currently rejected with HTTP 413. The gateway's
provider quotas continue to apply to model/tool-provider calls; runtime CRUD and
event streams do not consume model request allowances.

The initial live runtime is `grok-runtime-owner-8bit`, Machine `48e67eeb52ed58`,
on its own private network with an encrypted 1 GB volume. On 2026-09-08 UTC,
authenticated discovery, health, agent listing, test-bot creation/retention, and
unauthorized rejection passed through the deployed gateway. Its only allocated
IP is private ingress. This is an API smoke result; desktop conversation results
are tracked in `docs/FLY-HOSTING.md`. A native host test also retained its user
prompt and `READY` reply on the Fly volume (`check-hosted-turn.mjs --check`).
Normal desktop turns retain their custom tools and local transcript. Full remote
turns require the experimental desktop environment flag
`SAND_HOSTED_REMOTE_TURNS=1`; complete desktop tool parity is still pending.

Cross-network Fly replay is disabled by default at organization level. The initial
replay deployment returned HTTP 502 with that specific Fly Proxy error. Flycast
fixes this path without enabling organization-wide cross-network replay.

References: [custom private networks](https://fly.io/docs/networking/custom-private-networks/),
[Flycast](https://fly.io/docs/networking/flycast/), and
[Fly replay](https://fly.io/docs/networking/dynamic-request-routing/).

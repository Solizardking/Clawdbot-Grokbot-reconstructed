# Connect apps to Clawd Bot with Composio

Composio connects Clawd Bot to services such as Gmail, Slack, GitHub, and Calendar. Clawd Bot keeps a stable installation user and reuses a Composio Session. Provider authorization happens through Composio; do not paste provider tokens into chat.

## Set up connected apps

The installed desktop can use a configured managed broker. If Connections shows **Connected apps service is ready**, open **Connected apps** and authorize the provider you need. That status describes broker readiness, not a completed Gmail, Slack or other provider grant.

For your own project key, expand **Self-host connected apps** in **Settings → Connections**, then follow these steps:

1. Create or select a project in the [Composio dashboard](https://dashboard.composio.dev) and obtain its project API key.
2. Open **App Settings → Connections** in Clawd Bot and save the **Composio project key**.
3. Open **Connected apps**, select a service, and complete authorization in your browser.
4. For another account on the same service, choose **Add account** and use a distinct label, such as `work` or `personal`.

For provider-side authentication options, consult [Composio's authentication guide](https://docs.composio.dev/docs/tools-direct/authenticating-tools).

The desktop validates the project key before saving it through Electron's encrypted credential store. The app requires a label for a second account and enables explicit account selection. Disconnecting a row revokes that account, rather than every account for the service. The implementation caps each toolkit at five usable accounts.

For a scoped project key, the integration needs Sessions read/write, Toolkits read, and Connected accounts read/write. Revocation needs connected-account write permission.

## Source and headless installations

Run commands from the Clawd Bot repository root. Supply `COMPOSIO_API_KEY` through your server environment, then start:

```sh
npm run dev:server
```

The browser development flow can also save a key in the owner-only workspace configuration. Prefer environment-based configuration for headless deployments. The standalone server defaults to `~/.clawdbot/config.json`; packaged Electron uses its application-data workspace unless overridden.

Clawd Bot stores Session and user identifiers locally. Composio manages the provider grants. An older single-account Session can be replaced with a multi-account Session for the same installation user, retaining that user's existing connected accounts.

## Account inventory

Clients load connected accounts with:

```http
GET /api/connectors/connected
```

A representative configured response contains:

```json
{
  "configured": true,
  "services": {
    "gmail": {
      "connected": true,
      "pending": false,
      "status": "ACTIVE",
      "accounts": [{ "id": "ca_example", "alias": "work", "status": "ACTIVE" }]
    }
  }
}
```

The inventory combines paginated Session toolkit state and connected accounts. If raw account listing is unavailable to the scoped key, the integration can retain Session-selected and no-auth toolkit entries; this fallback is not proof that every account was listed. The scoped `GET /api/connectors?services=gmail,slack` route supports lightweight polling after authorization.

Managed mode exposes the corresponding broker route at `GET /v1/connectors/connected`. A configured broker address does not prove the service is deployed or authenticated. Verify its account inventory and an authorized operation before calling the integration connected.

## Troubleshooting

If no service is configured, finish project-key or managed-broker setup. If authorization completes but an account is missing, check the project, installation user, key permissions, and account status. If a provider disallows a second grant, use a separate installation user rather than repeatedly overwriting a single-account connection. Responses should expose account IDs, aliases, and status, never project keys or provider tokens.

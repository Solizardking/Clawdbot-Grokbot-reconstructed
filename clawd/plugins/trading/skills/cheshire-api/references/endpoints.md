# Cheshire API — endpoints & auth

## Base origins

| Origin | Use |
|--------|-----|
| `https://cheshireterminal.ai` | Public site, MCP, discovery, Fly proxy |
| `https://cheshire-clawd-terminal.fly.dev` | Primary Express REST API |
| `https://clawd-zero-service-1013652097839.us-central1.run.app` | Cloud Run zero-service (DFlow / SOL-GPT) |
| `https://34.54.168.40.nip.io` | Apigee env-group (`test-env`) |
| `https://clawd-gateway-cxnyacdr.uc.gateway.dev` | Google API Gateway (`?key=`) |

Prefer **cheshireterminal.ai** for public integrations.

## Machine discovery

| URL | Spec |
|-----|------|
| `GET /api/health` | Liveness + live trading flags (no secrets) |
| `GET /api/developer/status` | Integration readiness |
| `GET /api/developer/openapi.json` | OpenAPI 3.x |
| `GET /api/developer/llms.txt` | Compact LLM index |
| `GET /.well-known/agent-card.json` | Google A2A agent card |
| `GET /.well-known/agent-configuration` | Runtime discovery/configuration document |
| `GET /.well-known/mcp` | MCP discovery |
| `GET /.well-known/mcp/server-card.json` | MCP server card (12 tools) |
| `POST /mcp` | Streamable-HTTP MCP |
| `GET /api/skills` | Multi-source skills catalog |
| `GET /api/skills-store` | This store index |
| `GET /api/skills-store/:name` | One skill package metadata |
| `GET /api/skills-store/:name/SKILL.md` | Raw skill markdown |

## Authentication methods

| Method | How | Notes |
|--------|-----|--------|
| Cheshire API key | `Authorization: Bearer ct_sk_…` or `x-api-key: ct_sk_…` | Server-to-server; hashed at rest |
| Wallet session | Cookie after SIWS | Browser / holder surfaces |
| Clerk JWT | `Authorization: Bearer <jwt>` | Account portal |
| API Gateway key | `?key=YOUR_API_KEY` | Gateway-only |
| Apigee (tutorial proxies) | none on `myproxy` / `cheshire-zero` | Reverse proxies only |

### Key lifecycle

```bash
# Create (once — full key returned once)
POST /api/developer/keys
{ "name": "agent", "scopes": ["api:*"] }

# List
GET /api/developer/keys

# Revoke
DELETE /api/developer/keys/:id
```

Holder UI: `/api-keys` (Router Keys).

## Scopes

| Scope | Meaning |
|-------|---------|
| `api:*` | Normal authenticated API routes |
| `admin:*` | Admin routes (trusted operators only) |
| `route:<namespace>:*` | Route family e.g. `route:ai:*` |
| `route:<method>:/api/path` | Single method/path |

Public read routes (health, discovery, many market reads) do not require a key.

## Common REST families

Use OpenAPI as source of truth. High-traffic families:

| Prefix | Purpose |
|--------|---------|
| `/api/arena/*` | Agent rooms, join, messages |
| `/api/boxes/*` | Upstash box agents + sessions |
| `/api/dflow/*` | Spot quote / order proxy |
| `/api/jupiter/*` | Swap quotes (when exposed) |
| `/api/perps/*` / `/api/phoenix/*` | Perps surfaces |
| `/api/pump/*` | Pump.fun launch / trade builders |
| `/api/developer/*` | Keys, OpenAPI, status |
| `/api/skills*` | Skills catalog + store |

## Status fields (no secrets)

`GET /api/developer/status` / `GET /api/health` may expose:

- `clawdLive` — wallet-signed live trading flag
- `auth.clerkBearer.configured`
- `auth.apiKey.configured`
- `integrations.telegram|honcho|birdeye.configured`
- Upstash redis / qstash / search / box configured flags

Treat all as boolean readiness — never expect secret material in responses.

## Error handling

| Status | Meaning | Agent action |
|--------|---------|--------------|
| 401 | Missing/invalid auth | Attach `ct_sk_` or session |
| 403 | Scope insufficient | Request broader key or use public path |
| 404 | Unknown path | Re-check OpenAPI |
| 429 | Rate limited | Back off; honor `Retry-After` |
| 5xx | Upstream/server | Retry with jitter; fall back to discovery |

## Related docs in repo

- `API.md` — canonical reference
- `docs/cheshire-terminal-api.md` — product notes
- `docs/api-registration/*` — registration specs

## Automated verification

Run `bash skills-store/cheshire-api/scripts/smoke-discovery.sh`. Override `CHESHIRE_ORIGIN` to
test a local, preview, Fly, Apigee, or Cloud Run origin. The script validates payload signatures
and requires exactly 12 tools in the MCP server card; a generic HTML 200 response does not pass.

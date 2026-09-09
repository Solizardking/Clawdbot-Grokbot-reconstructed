---
name: paybox-get-started
description: Understand what PayBox access the user has granted and how to widen it. Use when the user asks what their wallet can do, or when a tool is blocked by a missing credential, a spend limit, or a strict approval mode. Covers the grant model and the approval modes.
license: MIT
---

# PayBox access, and what to do when it blocks you

Your standing instructions already cover the launch flow and the signing flow. This skill is the
grant model underneath them — what "granted" means and what to do when an operation is refused.

## Invoke this skill when

- A tool returns an access-policy block: missing credential, spend limit, strict approval mode
- The user asks what the wallet has access to, or wants to change it

## Granted is not the same as owned

`list_credentials` returns two sets: what this connector may use, and `ungranted` — credentials the
user owns but has not granted. **A credential that exists but is not granted is invisible to
operations.** Most "PayBox can't do X" is an ungranted credential, not a missing capability.

## Approval modes

Each granted credential carries one:

| Mode | Behaviour |
|---|---|
| `autonomous` | Signs without asking |
| `iframe` | Needs a confirm inside the signing window |
| `always_approve` | Needs the user's passkey in the PayBox app every time |

A blocked operation is often a mode, not a permission — `always_approve` will keep returning
`pending_approval` until the user approves in the app.

## Widening access

`request_account_change` takes `add` (grant from `ungranted`), `remove`, `create` (only when nothing
suitable exists), and `set_mode`. The `manage_url` it returns **changes nothing by itself** — the
user confirms in their own session with their passkey.

A newly granted or created wallet is still not usable until the user connects its signing key in the
PayBox window. `list_credentials` will show it granted before that, so granted status alone does not
mean you can sign.

## Never

- Never ask for a private key, seed phrase, or passphrase. PayBox never needs one, and no legitimate
  flow asks the agent for it.
- Never surface raw internal fields — `refresh_token`, envelope bytes — to the user.

# Upstash Box

This workspace defaults to the existing `polite-bulldog-70639` Box. Runs reuse
that Box and leave it intact. Its configured agent and model are used.

Install dependencies from the repository root:

```sh
npm --prefix clawd/box install
npm install -g @upstash/box-cli
```

Put `UPSTASH_BOX_API_KEY` in `clawd/box/.env` (ignored by Git).
Override the default with `UPSTASH_BOX_NAME`. Shell values take precedence,
followed by `box/.env`, then `clawd/.env`. Only Box settings are loaded.

```sh
npm --prefix clawd/box run check:auth
npm --prefix clawd/box run connect
npm --prefix clawd/box run example:cities
npm --prefix clawd/box run example:code
```

The connect command passes the key through the environment to `box connect`.
The cities example validates exactly five names using `zod/v3`; the code
example prints a random integer from 0 to 99. `npm start` inside this folder
also runs the cities example. Importing `openai-hop-session.cjs` continues to
expose the existing streaming adapter without running a Box example.

Agent API documentation: https://upstash.com/docs/box/overall/agent
SDK documentation: https://github.com/upstash/box/tree/main/packages/sdk

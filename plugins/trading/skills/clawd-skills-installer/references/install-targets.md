# Skill Install Targets

## Solizardking Catalog

List skills:

```bash
npx github:Solizardking/skillhub list
```

Install all skills to the default root:

```bash
npx github:Solizardking/skillhub install
```

Install all skills into an eve project:

```bash
npx github:Solizardking/skillhub install --eve
```

Install specific Clawd/Cheshire skills:

```bash
npx github:Solizardking/skillhub install solana-clawd clawd-token-ops cheshire-terminal clawd-agent-launchpad clawd-trading-terminal
```

Targets:

- `--agents`: `~/.agents/skills`
- `--codex`: `~/.codex/skills`
- `--claude`: `~/.claude/skills`
- `--eve`: `./agent/skills`
- `--target DIR`: custom directory

## Official Skills CLI Pattern

From the attached Vercel Agent Skills page:

```bash
npx skills add <owner/repo>
npx skills add <owner/repo> --skill <skill-name>
npx skills find <query>
```

In an eve project, the official `skills` CLI detects the project and offers to install into `agent/skills/`.

## Official Skills Mentioned By The User Attachment

- React/Next: `vercel-react-best-practices`, `vercel-composition-patterns`, `vercel-react-native-skills`, `next-best-practices`, `next-cache-components`, `next-upgrade`, `cra-to-next-migration`, `turborepo`.
- AI SDK: `ai-sdk`, `ai-elements`, `streamdown`.
- Design/UI: `web-design-guidelines`, `building-components`.
- Browser automation: `agent-browser`.
- Deployment: `vercel-deploy`, `vercel-cli`, `autoship`.
- Commerce/workflow: `ucp`, `workflow`.
- JSON Render: `json-render-core`, `json-render-react`, `json-render-react-native`, `json-render-remotion`, `remotion-best-practices`.
- Utility: `find-skills`, `before-and-after`.

Install those from their official repositories with `npx skills add ...`; install this repo's Clawd/Cheshire skills with `npx github:Solizardking/skillhub ...`.

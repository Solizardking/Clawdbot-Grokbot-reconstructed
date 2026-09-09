---
name: clawd-skills-installer
description: Install and make Clawd, Cheshire Terminal, Solizardking, Vercel, and eve agent skills available to local coding agents. Use when a user asks to add all skills, install this repo with npx github, install into ~/.agents/skills, ~/.codex/skills, ~/.claude/skills, or an eve project's agent/skills directory.
---

# Clawd Skills Installer

Use this skill when the task is about getting Clawd or Cheshire skills into an agent runtime. Load `references/install-targets.md` for exact commands and target directories.

## Default Install Commands

Install the full Solizardking skill catalog:

```bash
npx github:Solizardking/skillhub install
```

Install into an eve-style project:

```bash
npx github:Solizardking/skillhub install --eve
```

Install only Clawd and Cheshire skills:

```bash
npx github:Solizardking/skillhub install solana-clawd clawd-token-ops cheshire-terminal clawd-agent-launchpad clawd-trading-terminal clawd-skills-installer
```

## Target Policy

- Codex local skills: `~/.codex/skills`
- Claude local skills: `~/.claude/skills`
- Generic agent skills: `~/.agents/skills`
- eve project skills: `./agent/skills`

If a repo has `agent/skills`, prefer `--eve` or `--target agent/skills` so skills are available to the project agent rather than only the local coding agent.

## Vercel Skills CLI

Use the Vercel `skills` CLI for official Vercel/community skills from `skills.sh`:

```bash
npx skills add <owner/repo>
npx skills add <owner/repo> --skill <skill-name>
npx skills find <query>
```

Do not vendor official Vercel skills into this repository unless the user explicitly asks to mirror or fork them.

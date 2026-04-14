# @quydoan/myskills

[![npm version](https://img.shields.io/npm/v/@quydoan/myskills)](https://www.npmjs.com/package/@quydoan/myskills)

Personal [agentskills.io](https://agentskills.io) skills collection. Compatible with Claude Code, Cursor, Gemini CLI, Copilot, and any agent supporting the agentskills.io spec.

## Install

```bash
npx skills add RobDoan/myskills
```

Or install the CLI from npm:

```bash
npm install -g @quydoan/myskills
myskills install
```

## Add a New Skill

1. Create a directory under `skills/` with your skill name:

```bash
mkdir skills/my-new-skill
```

2. Create `skills/my-new-skill/SKILL.md` with YAML frontmatter:

```markdown
---
name: my-new-skill
description: What it does and when to use it.
metadata:
  author: quydoan
  version: "1.0"
---

# My New Skill

Instructions for the agent...
```

3. Validate locally:

```bash
npm run validate
```

## Track an Upstream Repo

Add an entry to `skill-repos.yml`:

```yaml
repos:
  - name: repo-name
    url: https://github.com/owner/repo
    branch: main
```

A weekly GitHub Action checks for changes and creates issues with compare links.

To check manually:

```bash
GITHUB_TOKEN=your_token GITHUB_REPOSITORY=RobDoan/myskills npm run check-upstream
```

## Development

```bash
npm install    # install dependencies
npm test       # run tests
npm run validate        # validate all skills
npm run check-upstream  # check upstream repos (requires GITHUB_TOKEN)
```

## Releases

This project uses [semantic-release](https://github.com/semantic-release/semantic-release) for automated versioning and publishing. Every push to `main` triggers a GitHub Actions workflow that:

1. Analyzes commits using [Conventional Commits](https://www.conventionalcommits.org/) (`fix:` = patch, `feat:` = minor, `BREAKING CHANGE` = major)
2. Publishes to [npm](https://www.npmjs.com/package/@quydoan/myskills)
3. Creates a [GitHub Release](https://github.com/RobDoan/myskills/releases) with an auto-generated changelog

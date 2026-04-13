# MySkills — Personal AgentSkills.io Skills Collection

## Overview

A GitHub-hosted repository (`quydoan/myskills`) for managing personal AI agent skills following the agentskills.io specification. Installable via `npx skills add quydoan/myskills`. Compatible with all agents supporting the agentskills.io spec (Claude Code, Cursor, Gemini CLI, Copilot, etc.).

The repo includes:
- Personal skills in agentskills.io format
- Validation tooling for SKILL.md files
- An upstream tracking system that watches external skill repos for changes

## Project Structure

```
quydoan/myskills/
├── skills/                        # personal skills (agentskills.io format)
│   ├── <skill-name>/
│   │   ├── SKILL.md               # required — frontmatter + instructions
│   │   ├── scripts/               # optional per-skill scripts
│   │   └── references/            # optional per-skill docs
│   └── ...
├── scripts/                       # repo-level tooling
│   ├── validate.js                # validates SKILL.md frontmatter
│   └── check-upstream.js          # checks upstream repos for changes
├── skill-repos.yml                # upstream repos to track
├── skill-repos.lock.yml           # last-known SHAs per repo
├── .github/
│   └── workflows/
│       ├── validate.yml           # runs on PRs — validates skill format
│       └── check-upstream.yml     # weekly — creates issues on upstream drift
├── package.json                   # dependencies for scripts
├── README.md
└── .gitignore
```

## Skill Format

Each skill follows the agentskills.io spec:

```markdown
---
name: my-skill-name
description: What it does and when to use it. Include keywords for agent matching.
license: MIT
compatibility: Any requirements (e.g., "Requires Node.js 18+")
metadata:
  author: quydoan
  version: "1.0"
---

# Skill Title

Instructions for the agent...
```

Rules:
- `name` must match the parent directory name
- `name` and `description` are required; everything else is optional
- `name`: lowercase letters, numbers, hyphens only, 1-64 chars, no leading/trailing/consecutive hyphens
- `description`: 1-1024 chars
- Keep SKILL.md under 500 lines; move detailed content to `references/`
- The repo ships with no skills initially

## Upstream Tracking System

### skill-repos.yml

Lists external skill repos to watch:

```yaml
repos:
  - name: anthropics-skills
    url: https://github.com/anthropics/skills
    branch: main
  - name: vercel-agent-skills
    url: https://github.com/vercel-labs/agent-skills
    branch: main
```

### skill-repos.lock.yml

Auto-managed by the check script. Stores last-known state:

```yaml
repos:
  - name: anthropics-skills
    url: https://github.com/anthropics/skills
    branch: main
    sha: abc123def456
    checked_at: "2026-04-13T00:00:00Z"
  - name: vercel-agent-skills
    url: https://github.com/vercel-labs/agent-skills
    branch: main
    sha: 789ghi012jkl
    checked_at: "2026-04-13T00:00:00Z"
```

### scripts/check-upstream.js

Logic:
1. Read `skill-repos.yml` for the list of repos
2. Read `skill-repos.lock.yml` for last-known SHAs
3. For each repo, fetch the current HEAD SHA of the tracked branch via GitHub API
4. If SHA differs from lock file:
   - Create a GitHub issue titled "Upstream update: <repo-name>"
   - Body includes the compare URL: `https://github.com/<owner>/<repo>/compare/<old-sha>...<new-sha>`
   - Skip if an open issue for that repo already exists (avoid duplicates)
5. Update `skill-repos.lock.yml` with the new SHAs and current timestamp
6. Commit the updated lock file directly to the default branch

### GitHub Action: check-upstream.yml

- Schedule: weekly (Sunday midnight UTC)
- Also supports `workflow_dispatch` for manual runs
- Uses `GITHUB_TOKEN` for API calls and issue creation
- Commits the updated lock file directly to the default branch (no PR needed for lock file updates)

## Validation System

### scripts/validate.js

Validates all skills in the repo:
1. Scan `skills/` for directories containing `SKILL.md`
2. For each skill, check:
   - YAML frontmatter is valid and parseable
   - `name` field exists, is lowercase, only letters/numbers/hyphens, 1-64 chars
   - `name` matches parent directory name
   - `description` field exists, 1-1024 chars
   - No orphaned directories (directories in `skills/` without a `SKILL.md`)
3. Exit code 0 on success, 1 on failure with clear error messages

### GitHub Action: validate.yml

- Runs on PRs that touch `skills/**`
- Installs dependencies (`npm ci`), runs `node scripts/validate.js`
- Blocks merge on failure

### Local use

`npm run validate`

## Dependencies

`package.json` includes:
- `yaml` — for parsing YAML frontmatter
- `@octokit/rest` — for GitHub API in the upstream checker

No dev dependencies or build tooling needed.

### package.json scripts

```json
{
  "scripts": {
    "validate": "node scripts/validate.js",
    "check-upstream": "node scripts/check-upstream.js"
  }
}
```

## README

Covers:
- What this repo is (personal agentskills.io skills collection)
- How to install: `npx skills add quydoan/myskills`
- How to add a new skill: create `skills/<name>/SKILL.md` with required frontmatter
- How to add an upstream repo to track: add entry to `skill-repos.yml`
- How to run validation locally: `npm run validate`
- How to manually check upstream: `npm run check-upstream`

## .gitignore

`node_modules/`

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal agentskills.io skills collection with validation tooling and upstream repo tracking. Installable via `npx skills add RobDoan/myskills`. Compatible with Claude Code, Cursor, Gemini CLI, Copilot, and any agentskills.io-supporting agent.

## Commands

```bash
npm test                              # Run all tests (Node.js built-in test runner)
node --test tests/validate.test.js    # Run validation tests only
node --test tests/check-upstream.test.js  # Run upstream checker tests only
npm run validate                      # Validate all skills in skills/
npm run check-upstream                # Check upstream repos (requires GITHUB_TOKEN and GITHUB_REPOSITORY env vars)
```

## Architecture

Two independent systems share a common structure:

**Validation system** (`scripts/validate.js`) — Scans `skills/` for subdirectories, parses SKILL.md YAML frontmatter, enforces agentskills.io spec rules (name must match dir, lowercase/hyphens only, 1-64 chars; description required, max 1024 chars), detects orphan directories without SKILL.md. Exports `validateSkillDir()` and `validateSkillsRoot()`.

**Upstream tracker** (`scripts/check-upstream.js`) — Reads `skill-repos.yml` for repos to watch, compares HEAD SHAs against `skill-repos.lock.yml`, creates GitHub issues with compare links when drift detected, deduplicates by checking for existing open issues with `upstream-update` label. Exports `loadReposConfig()`, `loadLockFile()`, `buildCompareUrl()`, `buildIssueTitle()`.

Both scripts have a CLI entrypoint guarded by `isMain` check, so they can be imported for testing without side effects.

## Adding Skills

Each skill is a directory under `skills/` containing a `SKILL.md` with YAML frontmatter. The `name` field must exactly match the directory name. Run `npm run validate` to check.

## Key Files

- `skill-repos.yml` — User-edited config listing upstream repos to track
- `skill-repos.lock.yml` — Auto-managed by check-upstream script; do not edit manually
- `.github/workflows/validate.yml` — Runs on PRs touching `skills/**`
- `.github/workflows/check-upstream.yml` — Weekly cron (Sunday midnight UTC) + manual dispatch

## Tech Stack

Node.js ESM, `yaml` package for frontmatter parsing, `@octokit/rest` for GitHub API. Tests use Node.js built-in `node:test` and `node:assert/strict` — no test framework dependency.

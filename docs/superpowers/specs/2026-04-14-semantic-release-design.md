# Semantic Release for @quydoan/myskills

## Goal

Automate npm publishing and GitHub Release creation using `semantic-release` whenever new commits land on `main`.

## Package Configuration

Update `package.json`:

- Rename to `@quydoan/myskills`
- Remove `"private": true`
- Add `"publishConfig": { "access": "public" }` (scoped packages default to private on npm)
- Add `"files": ["bin/", "lib/"]` to whitelist only the CLI and library code in the published tarball
- Version is managed by semantic-release (the value in `package.json` is overwritten at publish time)

## Semantic-release Configuration

Add `release.config.js` (ESM) with these plugins (all included with `semantic-release` by default):

1. `@semantic-release/commit-analyzer` — determines bump type from conventional commits (`fix:` = patch, `feat:` = minor, `BREAKING CHANGE` = major)
2. `@semantic-release/release-notes-generator` — generates changelog from commits
3. `@semantic-release/npm` — publishes `@quydoan/myskills` to npm
4. `@semantic-release/github` — creates GitHub Release with changelog

Branches: `["main"]` only.

Dev dependency to add: `semantic-release`.

## GitHub Actions Workflow

New file: `.github/workflows/release.yml`

- **Trigger**: `push` to `main`
- **Runner**: `ubuntu-latest`
- **Steps**:
  1. `actions/checkout@v5`
  2. `actions/setup-node@v5` — Node 22, npm cache
  3. `npm ci`
  4. `npx semantic-release`
- **Secrets**:
  - `GITHUB_TOKEN` — built-in, for GitHub Releases
  - `NPM_TOKEN` — repo secret, npm automation token with publish permission

Existing workflows (`validate.yml`, `check-upstream.yml`) are unchanged.

## Manual Setup (One-time)

Before the first release:

1. Create an npm access token (type: Automation) at npmjs.com
2. Add `NPM_TOKEN` as a repository secret in GitHub (Settings > Secrets > Actions)

## Scope

- No changes to existing scripts, tests, or workflows
- No bundler
- No changelog file committed to repo (changelog lives in GitHub Releases only)

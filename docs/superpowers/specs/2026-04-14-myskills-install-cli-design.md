# MySkills Install CLI — Design Spec

## Overview

A CLI tool (`npx myskills install`) that installs a curated set of agentskills.io skill repos into a project (or globally with `-g`). It reads a `skill-repos.lock.yml` file to determine which upstream repos to install, then installs the user's personal skills (`RobDoan/myskills`) as the final step.

## CLI Interface

```
npx myskills install        # project-scoped install
npx myskills install -g     # global install
```

### Lock File Resolution

1. Check if `skill-repos.lock.yml` exists in the current working directory.
2. If found, use it.
3. If not found, fetch from `https://raw.githubusercontent.com/RobDoan/myskills/main/skill-repos.lock.yml`.

### Install Sequence

1. Parse the lock file YAML and extract each repo's `url` field.
2. Convert URLs to `owner/repo` format (e.g., `https://github.com/anthropics/skills` becomes `anthropics/skills`).
3. For each repo, run `npx skills add [-g] <owner/repo>` sequentially.
4. After all lock file repos complete, run `npx skills add [-g] RobDoan/myskills`.

## File Structure

### New Files

- `bin/myskills.js` — CLI entry point with `#!/usr/bin/env node` shebang.

### Modified Files

- `package.json` — add `bin` field: `{ "myskills": "bin/myskills.js" }`.

## Implementation Details

### `bin/myskills.js`

Responsibilities:

1. Parse `process.argv` for the `install` command and `-g` flag.
2. Check `process.cwd()` for `skill-repos.lock.yml`.
3. If not found, fetch from GitHub raw content URL using `fetch()`.
4. Parse YAML using the existing `yaml` dependency.
5. Extract `owner/repo` from each entry's `url` field.
6. Spawn `npx skills add [-g] <owner/repo>` sequentially for each repo.
7. Finally spawn `npx skills add [-g] RobDoan/myskills`.
8. Exit with non-zero code if any install fails.

### Argument Parsing

No CLI framework — use `process.argv` directly. The surface is small:
- `install` command (required, only command)
- `-g` flag (optional)
- Anything else prints usage and exits with code 1.

### Error Handling

- Missing `install` command: print usage, exit 1.
- Lock file fetch failure: print error, exit 1.
- YAML parse failure: print error, exit 1.
- `npx skills add` failure for a repo: print which repo failed, continue with remaining repos, exit 1 at the end.

### Output

Simple console.log messages:

```
Using local skill-repos.lock.yml
Installing anthropics/skills...
Installing vercel-labs/agent-skills...
Installing RobDoan/myskills...
Done. 3 skill repos installed.
```

Or for remote fetch:

```
Fetching skill-repos.lock.yml from RobDoan/myskills...
Installing anthropics/skills...
Installing vercel-labs/agent-skills...
Installing RobDoan/myskills...
Done. 3 skill repos installed.
```

## Testing

### File

`tests/install.test.js`

### Strategy

- Mock `child_process.execFile` to avoid running `npx skills add`.
- Mock `fetch` for the remote lock file scenario.
- Use the existing `yaml` dependency directly (no mock).

### Test Cases

1. Uses local `skill-repos.lock.yml` when present in cwd.
2. Fetches remote lock file when no local file exists.
3. Passes `-g` flag through to `npx skills add` when provided.
4. Installs all lock file repos then `RobDoan/myskills` last.
5. Extracts `owner/repo` correctly from full GitHub URLs.
6. Exits with error on invalid/missing command.
7. Exits with error when lock file fetch fails.
8. Continues installing remaining repos when one fails, exits non-zero.

## Dependencies

No new dependencies. Uses:
- `yaml` (existing)
- `node:child_process` (built-in)
- `node:fs/promises` (built-in)
- `node:path` (built-in)
- Global `fetch` (Node.js built-in)

## Constraints

- Source repo for remote lock file is hardcoded to `RobDoan/myskills` on `main` branch.
- `RobDoan/myskills` is always installed as the final step (not skippable).
- Repos are installed sequentially to avoid race conditions in the `skills` CLI.

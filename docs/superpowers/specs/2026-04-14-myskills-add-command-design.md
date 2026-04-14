# myskills add Command Design

## Summary

Add an `add` subcommand to the `myskills` CLI that installs all tracked skill repos, installs a new repo, and appends it to the local `skill-repos.yml`. Also refactor the existing `install` command to read from `skill-repos.yml` instead of `skill-repos.lock.yml`.

## Changes

### 1. Refactor `lib/install.js` — switch from lock file to config file

**Current:** Reads `skill-repos.lock.yml`, parses `repos[].url` to get `owner/repo`.
**New:** Reads `skill-repos.yml` instead. Same structure — it has `repos[].url`.

Renames:
- `LOCK_FILE_NAME` → `CONFIG_FILE_NAME` = `"skill-repos.yml"`
- `REMOTE_LOCK_URL` → `REMOTE_CONFIG_URL` pointing to `skill-repos.yml` on the remote
- `resolveLockFileContent()` → `resolveConfigContent()`
- `parseLockFileYaml()` → `parseConfigYaml()`

No changes to `installSkillRepos()` or `extractOwnerRepo()` — they work with the same data shape.

### 2. New functions in `lib/install.js`

**`addRepoToConfig(configContent, repoId)`** — Takes existing YAML content string and a repo identifier (e.g. `someuser/somerepo`). Checks if the repo already exists in the list (by URL). If not, appends a new entry with `name` (derived from `owner/repo`) and `url` (`https://github.com/<repoId>`). Returns the updated YAML string.

**`saveConfigFile(cwd, content)`** — Writes the updated YAML content to `skill-repos.yml` in the given directory.

**`parseArgs` update** — Recognize `add <repo>` as a command, returning `{ command: "add", repo: "<repo>" }`.

### 3. CLI orchestration in `bin/myskills.js`

**`install` command** (refactored):
- Same flow as today, reads `skill-repos.yml` instead of lock file.
- `-g` flag still supported.

**`add <repo>` command** (new):
1. Resolve config — download `skill-repos.yml` from remote if no local copy exists.
2. Save config locally if fetched from remote.
3. Check if repo already in config — if yes, log "already exists" and exit.
4. Run the install flow (install all repos from config). Already-installed skills are handled by `npx skills add` itself.
5. Run `npx skills add <repo>` for the new repo.
6. If `npx skills add` fails → report error, do NOT update config.
7. If successful, append repo to local `skill-repos.yml` via `addRepoToConfig()` + `saveConfigFile()`.

**Usage/help text:**
```
Usage: myskills <command>

Commands:
  install [-g]       Install skill repos from skill-repos.yml
  add <repo>         Install all skills, add a new repo, and update config
```

**Error behavior:**
- `add` without `<repo>` argument → print usage, exit 1.
- Repo already in config → skip entirely, log "already exists".
- `npx skills add <repo>` fails → skip config update, report error, exit 1.
- Only update `skill-repos.yml` if the repo is new AND install succeeds.

### 4. Tests

**Existing tests updated:**
- Install tests use new function names (`resolveConfigContent`, `parseConfigYaml`).

**New test cases:**
- `addRepoToConfig()` appends a new repo entry to YAML content.
- `addRepoToConfig()` with a repo that already exists returns content unchanged or signals duplicate.
- `parseArgs` correctly parses `add <repo>` command.
- `parseArgs` returns null command when `add` is missing the repo argument.

No integration tests — CLI orchestration is thin and relies on tested building blocks.

## Files Modified

- `lib/install.js` — refactor to use `skill-repos.yml`, add new functions
- `bin/myskills.js` — add `add` command routing and orchestration
- `tests/install.test.js` (or equivalent) — update and add test cases
- `package.json` — no changes needed (bin entry already exists)

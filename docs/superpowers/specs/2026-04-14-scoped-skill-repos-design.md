# Scoped Skill Repos Design

**Date:** 2026-04-14

## Overview

Add scope-based categories to `skill-repos.yml` so users can install subsets of skills. Scopes filter at the skill level — a single repo can have skills spread across multiple scopes.

## Config Format

`skill-repos.yml` uses scopes as top-level keys. Each scope contains an array of repo entries with `url` (shorthand `owner/repo`) and `skills` (array of skill names).

```yaml
default:
  - url: anthropics/skills
    skills: [pr-review, commit]
  - url: vercel-labs/agent-skills
    skills: [vercel-react-best-practices]

frontend:
  - url: anthropics/skills
    skills: [frontend-design]
  - url: vercel-labs/agent-skills
    skills: [vercel-react-view-transitions]
```

- Must have at least a `default` scope.
- Entries without a scope don't exist — every entry lives under an explicit scope.

## CLI Interface

```
npx myskills install                          # Install all scopes
npx myskills install -s frontend              # Install default + frontend
npx myskills install -s frontend,backend      # Install default + frontend + backend
npx myskills install -g                       # Global install, all scopes
npx myskills install -g -s frontend           # Global install, default + frontend
```

- `-s` accepts comma-separated scope names.
- `default` is always implicitly included when `-s` is used.
- Without `-s`, all scopes are installed.
- `-g` flag works the same as today.

`parseArgs` returns a `scopes` field:
- No `-s` flag → `scopes: null` (meaning "all").
- `-s frontend` → `scopes: ["frontend"]` (`default` is added at install time, not parse time).

## Install Logic

1. **Parse config** — `parseConfigYaml` returns a scope map: `{ default: [...], frontend: [...] }`.
2. **Resolve active scopes** — if `scopes` is `null`, use all keys from config. Otherwise, use `["default", ...requestedScopes]`. Validate that all requested scopes exist in the config; error if not.
3. **Collect repo entries** — gather all entries from active scopes into a flat list.
4. **Handle self-repo (`RobDoan/myskills`)** — always installs first:
   - If `RobDoan/myskills` appears in any active scope entry: collect its skills from those entries, deduplicate, and install with `--skill` filter.
   - If `RobDoan/myskills` is NOT in any active scope: install all skills (no `--skill` filter).
5. **Deduplicate other repos** — same `url` appearing in multiple active scopes gets its `skills` arrays merged and deduplicated.
6. **Install** — for each deduplicated entry, run `npx skills add` with the merged skills list.

## Function Changes

### `parseConfigYaml(content)`
Returns `Record<string, Array<{url, skills}>>` instead of a flat array. Validates that `default` scope exists.

### `extractOwnerRepo(url)`
No longer needed for the install path since URLs are already `owner/repo` shorthand. Keep it for the upstream tracker which still uses full GitHub URLs.

### `parseArgs(argv)`
Adds `scopes` field. Parses `-s` flag, splits on commas. Returns `scopes: null` when no `-s` provided.

### `buildAddArgs(repoId, opts)`
No changes needed — already supports `skills` array.

### `installSkillRepos(scopeMap, opts)`
New signature. Takes scope map + `{ global, scopes, execFn, log }`. Handles scope resolution, deduplication, self-repo logic, and install ordering.

### `resolveConfigContent(cwd, fetchFn)`
No changes needed.

## Error Handling & Validation

- **Missing `default` scope in config** — error: "Invalid config: missing required 'default' scope".
- **Unknown scope requested** — error: "Unknown scope(s): backend. Available: default, frontend".
- **Empty scope (no entries)** — valid, just nothing to install from that scope.
- **Config has no scope keys at all** — error: "Invalid config: no scopes defined".

Existing failure handling (failed installs, bad fetch) stays the same.

## Testing

Update existing tests and add new ones:

- **`parseConfigYaml`** — test new scope-map format, validate `default` required, handle empty scopes.
- **`parseArgs`** — test `-s frontend`, `-s frontend,backend`, no `-s`, combined with `-g`.
- **`installSkillRepos`** — test scope resolution (all scopes, specific scopes, unknown scope error), skill deduplication across scopes, self-repo behavior (in config with skills vs. not in config), install ordering (self-repo first).
- **`buildAddArgs`** — no changes needed, existing tests stay.

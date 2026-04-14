# Scoped Skill Repos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scope-based categories to `skill-repos.yml` so `npx myskills install -s frontend` installs only `default` + `frontend` skills.

**Architecture:** Config becomes a scope map (top-level keys are scope names, values are arrays of `{url, skills}` entries). `parseArgs` gains `-s` flag support. `installSkillRepos` resolves active scopes, deduplicates repos/skills across scopes, handles self-repo priority, then installs.

**Tech Stack:** Node.js ESM, `yaml` package, `node:test` + `node:assert/strict`

---

## File Structure

- **Modify:** `lib/install.js` — `parseConfigYaml`, `parseArgs`, `installSkillRepos` updated for scoped config
- **Modify:** `bin/myskills.js` — pass `scopes` from parsed args to install function
- **Modify:** `tests/install.test.js` — update all existing tests, add new scope-related tests
- **Modify:** `skill-repos.yml` — migrate to scoped format

---

### Task 1: Update `parseConfigYaml` to return scope map

**Files:**
- Modify: `lib/install.js:28-34`
- Test: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for new `parseConfigYaml`**

In `tests/install.test.js`, replace the existing `parseConfigYaml` describe block:

```js
describe("parseConfigYaml", () => {
  it("parses scoped config and returns scope map", () => {
    const yaml = `default:
  - url: anthropics/skills
    skills: [pr-review, commit]

frontend:
  - url: anthropics/skills
    skills: [frontend-design]
`;
    const scopeMap = parseConfigYaml(yaml);
    assert.deepEqual(Object.keys(scopeMap), ["default", "frontend"]);
    assert.equal(scopeMap.default.length, 1);
    assert.equal(scopeMap.default[0].url, "anthropics/skills");
    assert.deepEqual(scopeMap.default[0].skills, ["pr-review", "commit"]);
    assert.equal(scopeMap.frontend.length, 1);
    assert.deepEqual(scopeMap.frontend[0].skills, ["frontend-design"]);
  });

  it("throws when default scope is missing", () => {
    const yaml = `frontend:
  - url: anthropics/skills
    skills: [frontend-design]
`;
    assert.throws(() => parseConfigYaml(yaml), /missing required 'default' scope/);
  });

  it("throws when config has no scope keys", () => {
    assert.throws(() => parseConfigYaml(""), /no scopes defined/);
  });

  it("accepts empty scope arrays", () => {
    const yaml = `default:
  - url: anthropics/skills
    skills: [pr-review]
frontend: []
`;
    const scopeMap = parseConfigYaml(yaml);
    assert.deepEqual(scopeMap.frontend, []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js 2>&1 | head -30`
Expected: FAIL — existing `parseConfigYaml` returns a flat array, not a scope map.

- [ ] **Step 3: Update `parseConfigYaml` implementation**

In `lib/install.js`, replace the existing `parseConfigYaml` function:

```js
export function parseConfigYaml(content) {
  const parsed = parseYaml(content);
  if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length === 0) {
    throw new Error("Invalid config: no scopes defined");
  }
  if (!("default" in parsed)) {
    throw new Error("Invalid config: missing required 'default' scope");
  }
  const scopeMap = {};
  for (const [scope, entries] of Object.entries(parsed)) {
    scopeMap[scope] = Array.isArray(entries) ? entries : [];
  }
  return scopeMap;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js 2>&1 | head -30`
Expected: `parseConfigYaml` tests PASS. Other tests may fail (they depend on old format) — that's expected.

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: update parseConfigYaml to return scope map"
```

---

### Task 2: Update `parseArgs` to support `-s` flag

**Files:**
- Modify: `lib/install.js:44-54`
- Test: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for `-s` flag parsing**

In `tests/install.test.js`, replace the existing `parseArgs` describe block:

```js
describe("parseArgs", () => {
  it("parses install command", () => {
    const result = parseArgs(["node", "myskills", "install"]);
    assert.equal(result.command, "install");
    assert.equal(result.global, false);
    assert.equal(result.scopes, null);
  });

  it("parses install -g", () => {
    const result = parseArgs(["node", "myskills", "install", "-g"]);
    assert.equal(result.command, "install");
    assert.equal(result.global, true);
    assert.equal(result.scopes, null);
  });

  it("parses install -s with single scope", () => {
    const result = parseArgs(["node", "myskills", "install", "-s", "frontend"]);
    assert.equal(result.command, "install");
    assert.deepEqual(result.scopes, ["frontend"]);
  });

  it("parses install -s with comma-separated scopes", () => {
    const result = parseArgs(["node", "myskills", "install", "-s", "frontend,backend"]);
    assert.deepEqual(result.scopes, ["frontend", "backend"]);
  });

  it("parses install -g -s combined", () => {
    const result = parseArgs(["node", "myskills", "install", "-g", "-s", "frontend"]);
    assert.equal(result.global, true);
    assert.deepEqual(result.scopes, ["frontend"]);
  });

  it("returns null command for missing args", () => {
    const result = parseArgs(["node", "myskills"]);
    assert.equal(result.command, null);
  });

  it("returns null command for unknown command", () => {
    const result = parseArgs(["node", "myskills", "unknown"]);
    assert.equal(result.command, null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js 2>&1 | grep -E "(parseArgs|FAIL|PASS)"`
Expected: FAIL — `scopes` field doesn't exist yet.

- [ ] **Step 3: Update `parseArgs` implementation**

In `lib/install.js`, replace the existing `parseArgs` function:

```js
export function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const isGlobal = args.includes("-g");

  let scopes = null;
  const sIndex = args.indexOf("-s");
  if (sIndex !== -1 && sIndex + 1 < args.length) {
    scopes = args[sIndex + 1].split(",").filter(Boolean);
  }

  if (command === "install") {
    return { command: "install", global: isGlobal, scopes };
  }

  return { command: null, global: false, scopes: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js 2>&1 | grep -E "(parseArgs|FAIL|PASS)"`
Expected: All `parseArgs` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add -s scope flag to parseArgs"
```

---

### Task 3: Add `resolveActiveScopes` helper

**Files:**
- Modify: `lib/install.js`
- Test: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for `resolveActiveScopes`**

Add a new import for `resolveActiveScopes` at the top of `tests/install.test.js` (add it to the existing import), then add this describe block:

```js
describe("resolveActiveScopes", () => {
  const scopeMap = {
    default: [{ url: "anthropics/skills", skills: ["pr-review"] }],
    frontend: [{ url: "anthropics/skills", skills: ["frontend-design"] }],
    backend: [{ url: "some/repo", skills: ["api-builder"] }],
  };

  it("returns all scope keys when scopes is null", () => {
    const result = resolveActiveScopes(scopeMap, null);
    assert.deepEqual(result.sort(), ["backend", "default", "frontend"]);
  });

  it("returns default plus requested scopes", () => {
    const result = resolveActiveScopes(scopeMap, ["frontend"]);
    assert.deepEqual(result.sort(), ["default", "frontend"]);
  });

  it("deduplicates when default is explicitly requested", () => {
    const result = resolveActiveScopes(scopeMap, ["default", "frontend"]);
    assert.deepEqual(result.sort(), ["default", "frontend"]);
  });

  it("throws on unknown scope", () => {
    assert.throws(
      () => resolveActiveScopes(scopeMap, ["mobile"]),
      /Unknown scope\(s\): mobile\. Available: default, frontend, backend/
    );
  });

  it("lists multiple unknown scopes in error", () => {
    assert.throws(
      () => resolveActiveScopes(scopeMap, ["mobile", "devops"]),
      /Unknown scope\(s\): mobile, devops/
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js 2>&1 | grep -E "(resolveActiveScopes|FAIL)"`
Expected: FAIL — `resolveActiveScopes` is not defined.

- [ ] **Step 3: Implement `resolveActiveScopes`**

In `lib/install.js`, add this function after `parseArgs`:

```js
export function resolveActiveScopes(scopeMap, scopes) {
  if (scopes === null) {
    return Object.keys(scopeMap);
  }
  const available = Object.keys(scopeMap);
  const unknown = scopes.filter((s) => !available.includes(s));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown scope(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`
    );
  }
  return [...new Set(["default", ...scopes])];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js 2>&1 | grep -E "(resolveActiveScopes|FAIL|PASS)"`
Expected: All `resolveActiveScopes` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add resolveActiveScopes helper"
```

---

### Task 4: Add `collectRepoEntries` helper for deduplication

**Files:**
- Modify: `lib/install.js`
- Test: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for `collectRepoEntries`**

Add `collectRepoEntries` to the import in `tests/install.test.js`, then add:

```js
describe("collectRepoEntries", () => {
  it("merges skills for same url across scopes", () => {
    const scopeMap = {
      default: [{ url: "anthropics/skills", skills: ["pr-review", "commit"] }],
      frontend: [{ url: "anthropics/skills", skills: ["frontend-design"] }],
    };
    const entries = collectRepoEntries(scopeMap, ["default", "frontend"]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].url, "anthropics/skills");
    assert.deepEqual(entries[0].skills, ["pr-review", "commit", "frontend-design"]);
  });

  it("deduplicates skills within merged entries", () => {
    const scopeMap = {
      default: [{ url: "anthropics/skills", skills: ["pr-review"] }],
      frontend: [{ url: "anthropics/skills", skills: ["pr-review", "frontend-design"] }],
    };
    const entries = collectRepoEntries(scopeMap, ["default", "frontend"]);
    assert.deepEqual(entries[0].skills, ["pr-review", "frontend-design"]);
  });

  it("returns multiple repos when urls differ", () => {
    const scopeMap = {
      default: [
        { url: "anthropics/skills", skills: ["pr-review"] },
        { url: "vercel-labs/agent-skills", skills: ["best-practices"] },
      ],
    };
    const entries = collectRepoEntries(scopeMap, ["default"]);
    assert.equal(entries.length, 2);
  });

  it("returns empty array for empty scopes", () => {
    const scopeMap = { default: [], frontend: [] };
    const entries = collectRepoEntries(scopeMap, ["default", "frontend"]);
    assert.equal(entries.length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js 2>&1 | grep -E "(collectRepoEntries|FAIL)"`
Expected: FAIL — `collectRepoEntries` is not defined.

- [ ] **Step 3: Implement `collectRepoEntries`**

In `lib/install.js`, add this function after `resolveActiveScopes`:

```js
export function collectRepoEntries(scopeMap, activeScopes) {
  const merged = new Map();
  for (const scope of activeScopes) {
    for (const entry of scopeMap[scope] || []) {
      if (!merged.has(entry.url)) {
        merged.set(entry.url, { url: entry.url, skills: [...entry.skills] });
      } else {
        const existing = merged.get(entry.url);
        for (const skill of entry.skills) {
          if (!existing.skills.includes(skill)) {
            existing.skills.push(skill);
          }
        }
      }
    }
  }
  return [...merged.values()];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js 2>&1 | grep -E "(collectRepoEntries|FAIL|PASS)"`
Expected: All `collectRepoEntries` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add collectRepoEntries for scope deduplication"
```

---

### Task 5: Update `installSkillRepos` for scoped install

**Files:**
- Modify: `lib/install.js:68-93`
- Test: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for new `installSkillRepos`**

In `tests/install.test.js`, replace the existing `installSkillRepos`, `installSkillRepos logging`, and `installSkillRepos with skills` describe blocks with:

```js
describe("installSkillRepos", () => {
  const scopeMap = {
    default: [
      { url: "anthropics/skills", skills: ["pr-review", "commit"] },
    ],
    frontend: [
      { url: "anthropics/skills", skills: ["frontend-design"] },
      { url: "vercel-labs/agent-skills", skills: ["react-transitions"] },
    ],
  };

  it("installs all scopes when scopes is null", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => calls.push({ cmd, args });

    const result = await installSkillRepos(scopeMap, {
      global: false,
      scopes: null,
      execFn: mockExec,
    });

    // Self-repo first (not in config, so no --skill filter)
    assert.deepEqual(calls[0].args, ["skills", "add", "-p", "RobDoan/myskills"]);
    // Then other repos with merged skills
    assert.deepEqual(calls[1].args, [
      "skills", "add", "-p", "anthropics/skills",
      "--skill", "pr-review", "commit", "frontend-design",
    ]);
    assert.deepEqual(calls[2].args, [
      "skills", "add", "-p", "vercel-labs/agent-skills",
      "--skill", "react-transitions",
    ]);
    assert.equal(result.installed, 3);
    assert.equal(result.failed, 0);
  });

  it("installs default + requested scope", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => calls.push({ cmd, args });

    await installSkillRepos(scopeMap, {
      global: false,
      scopes: ["frontend"],
      execFn: mockExec,
    });

    assert.deepEqual(calls[0].args, ["skills", "add", "-p", "RobDoan/myskills"]);
    assert.deepEqual(calls[1].args, [
      "skills", "add", "-p", "anthropics/skills",
      "--skill", "pr-review", "commit", "frontend-design",
    ]);
    assert.deepEqual(calls[2].args, [
      "skills", "add", "-p", "vercel-labs/agent-skills",
      "--skill", "react-transitions",
    ]);
  });

  it("installs only default when scope has no extra entries", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => calls.push({ cmd, args });

    const minimalMap = {
      default: [{ url: "anthropics/skills", skills: ["pr-review"] }],
      frontend: [],
    };

    await installSkillRepos(minimalMap, {
      global: false,
      scopes: ["frontend"],
      execFn: mockExec,
    });

    assert.equal(calls.length, 2); // self-repo + anthropics/skills
    assert.deepEqual(calls[1].args, [
      "skills", "add", "-p", "anthropics/skills",
      "--skill", "pr-review",
    ]);
  });

  it("passes -g flag when global is true", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => calls.push({ cmd, args });

    await installSkillRepos(scopeMap, {
      global: true,
      scopes: null,
      execFn: mockExec,
    });

    assert.deepEqual(calls[0].args, ["skills", "add", "-g", "RobDoan/myskills"]);
    assert.deepEqual(calls[1].args[2], "-g");
  });

  it("throws on unknown scope", async () => {
    const mockExec = async () => {};
    await assert.rejects(
      () => installSkillRepos(scopeMap, { scopes: ["mobile"], execFn: mockExec }),
      /Unknown scope\(s\): mobile/
    );
  });

  it("filters self-repo skills when self-repo is in active scopes", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => calls.push({ cmd, args });

    const mapWithSelf = {
      default: [
        { url: "RobDoan/myskills", skills: ["brainstorming"] },
        { url: "anthropics/skills", skills: ["pr-review"] },
      ],
    };

    await installSkillRepos(mapWithSelf, {
      global: false,
      scopes: null,
      execFn: mockExec,
    });

    // Self-repo installed first WITH skill filter
    assert.deepEqual(calls[0].args, [
      "skills", "add", "-p", "RobDoan/myskills",
      "--skill", "brainstorming",
    ]);
    // Other repo after
    assert.deepEqual(calls[1].args, [
      "skills", "add", "-p", "anthropics/skills",
      "--skill", "pr-review",
    ]);
  });

  it("merges self-repo skills across scopes", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => calls.push({ cmd, args });

    const mapWithSelf = {
      default: [{ url: "RobDoan/myskills", skills: ["brainstorming"] }],
      frontend: [{ url: "RobDoan/myskills", skills: ["frontend-design"] }],
    };

    await installSkillRepos(mapWithSelf, {
      global: false,
      scopes: null,
      execFn: mockExec,
    });

    assert.deepEqual(calls[0].args, [
      "skills", "add", "-p", "RobDoan/myskills",
      "--skill", "brainstorming", "frontend-design",
    ]);
  });

  it("continues after a failed install and reports failure", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => {
      calls.push({ cmd, args });
      if (args.includes("anthropics/skills")) throw new Error("fail");
    };

    const result = await installSkillRepos(scopeMap, {
      global: false,
      scopes: null,
      execFn: mockExec,
    });

    assert.equal(result.installed, 2); // self-repo + vercel
    assert.equal(result.failed, 1);
    assert.deepEqual(result.failures, ["anthropics/skills"]);
  });

  it("logs each repo being installed", async () => {
    const logs = [];
    const mockExec = async () => {};

    await installSkillRepos(scopeMap, {
      global: false,
      scopes: null,
      execFn: mockExec,
      log: (msg) => logs.push(msg),
    });

    assert.ok(logs.some((l) => l.includes("RobDoan/myskills")));
    assert.ok(logs.some((l) => l.includes("anthropics/skills")));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js 2>&1 | grep -E "(installSkillRepos|FAIL)"`
Expected: FAIL — `installSkillRepos` still takes a flat array.

- [ ] **Step 3: Update `installSkillRepos` implementation**

In `lib/install.js`, replace the existing `installSkillRepos` function:

```js
export async function installSkillRepos(scopeMap, { global: isGlobal = false, scopes = null, execFn, log = () => {} }) {
  const activeScopes = resolveActiveScopes(scopeMap, scopes);
  const allEntries = collectRepoEntries(scopeMap, activeScopes);

  // Separate self-repo from other repos
  const selfEntry = allEntries.find((e) => e.url === SELF_REPO);
  const otherEntries = allEntries.filter((e) => e.url !== SELF_REPO);

  // Build install queue: self-repo first
  const queue = [];
  if (selfEntry) {
    queue.push({ repoId: SELF_REPO, skills: selfEntry.skills });
  } else {
    queue.push({ repoId: SELF_REPO, skills: [] });
  }
  for (const entry of otherEntries) {
    queue.push({ repoId: entry.url, skills: entry.skills });
  }

  let installed = 0;
  let failed = 0;
  const failures = [];

  for (const { repoId, skills } of queue) {
    log(`Installing ${repoId}...`);
    const args = buildAddArgs(repoId, { global: isGlobal, skills });
    try {
      await execFn("npx", args);
      installed++;
    } catch {
      log(`Failed to install ${repoId}`);
      failed++;
      failures.push(repoId);
    }
  }

  return { installed, failed, failures };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js 2>&1 | grep -E "(FAIL|PASS|tests)"`
Expected: All `installSkillRepos` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: update installSkillRepos for scoped config"
```

---

### Task 6: Update `bin/myskills.js` CLI entry point

**Files:**
- Modify: `bin/myskills.js`

- [ ] **Step 1: Update CLI to pass scopes and update usage text**

In `bin/myskills.js`, replace the full file content:

```js
#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  parseArgs,
  resolveConfigContent,
  parseConfigYaml,
  installSkillRepos,
} from "../lib/install.js";

const USAGE = `Usage: myskills <command>

Commands:
  install [-g] [-s <scopes>]  Install skill repos from skill-repos.yml

Options:
  -g              Install globally
  -s <scopes>     Comma-separated scopes (e.g. -s frontend,backend)
                  Installs default + specified scopes. Without -s, installs all.`;

const { command, global: isGlobal, scopes } = parseArgs(process.argv);

const execFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Exit code ${code}`))
    );
    child.on("error", reject);
  });

if (command === "install") {
  try {
    const cwd = process.cwd();
    const { content, source } = await resolveConfigContent(cwd);

    if (source === "local") {
      console.log("Using local skill-repos.yml");
    } else {
      console.log("Fetching skill-repos.yml from RobDoan/myskills...");
    }

    const scopeMap = parseConfigYaml(content);

    const result = await installSkillRepos(scopeMap, {
      global: isGlobal,
      scopes,
      execFn,
      log: (msg) => console.log(msg),
    });

    if (result.failed > 0) {
      console.error(`\nFailed to install: ${result.failures.join(", ")}`);
      console.log(`Done. ${result.installed} installed, ${result.failed} failed.`);
      process.exit(1);
    }

    console.log(`Done. ${result.installed} skill repos installed.`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
} else {
  console.error(USAGE);
  process.exit(1);
}
```

- [ ] **Step 2: Run all tests to verify nothing is broken**

Run: `node --test tests/install.test.js`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add bin/myskills.js
git commit -m "feat: update CLI to support -s scope flag"
```

---

### Task 7: Migrate `skill-repos.yml` to scoped format

**Files:**
- Modify: `skill-repos.yml`

- [ ] **Step 1: Update `skill-repos.yml` to scoped format**

Replace the contents of `skill-repos.yml`:

```yaml
default:
  - url: anthropics/skills
    skills: []
  - url: vercel-labs/agent-skills
    skills: []
```

Note: Both repos currently install all skills. The `skills: []` means no `--skill` filter is applied (empty array = no filter via `buildAddArgs`). Adjust to list specific skills per scope as needed.

- [ ] **Step 2: Run validation to verify config parses**

Run: `node -e "import {parseConfigYaml} from './lib/install.js'; import fs from 'fs'; const c = fs.readFileSync('skill-repos.yml','utf-8'); console.log(JSON.stringify(parseConfigYaml(c), null, 2));"`
Expected: Prints the scope map with `default` key containing both repos.

- [ ] **Step 3: Commit**

```bash
git add skill-repos.yml
git commit -m "chore: migrate skill-repos.yml to scoped format"
```

---

### Task 8: Clean up removed `SAMPLE_CONFIG_YAML` and `resolveConfigContent` tests

**Files:**
- Modify: `tests/install.test.js`

- [ ] **Step 1: Update `SAMPLE_CONFIG_YAML` and `resolveConfigContent` tests**

The `SAMPLE_CONFIG_YAML` constant and `resolveConfigContent` tests at the top of the file still use the old flat format. Update them:

Replace the `SAMPLE_CONFIG_YAML` constant:

```js
const SAMPLE_CONFIG_YAML = `default:
  - url: anthropics/skills
    skills: [pr-review]
`;
```

The `resolveConfigContent` tests don't parse the YAML — they just check that the content string is returned. The assertions check `content.includes("anthropics-skills")` which won't match the new format. Update to check for `"anthropics/skills"` instead:

In the `resolveConfigContent` describe block, update the two assertions:
- Change `assert.ok(content.includes("anthropics-skills"))` to `assert.ok(content.includes("anthropics/skills"))`
- Do this in both the "reads local" and "fetches remote" tests.

- [ ] **Step 2: Run all tests**

Run: `node --test tests/install.test.js`
Expected: ALL tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/install.test.js
git commit -m "test: update test fixtures for scoped config format"
```

---

### Task 9: Remove unused `extractOwnerRepo` tests (optional cleanup)

**Files:**
- Modify: `tests/install.test.js`

- [ ] **Step 1: Verify `extractOwnerRepo` is still used**

`extractOwnerRepo` is still used by the upstream tracker (`scripts/check-upstream.js`), so keep the function in `lib/install.js`. However, it's no longer used in the install path. The existing tests for it are still valid and should remain to protect the upstream tracker.

No changes needed — skip this task.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 3: Final commit if any cleanup was done**

No commit needed if no changes.

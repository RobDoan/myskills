# Install CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `npx myskills install [-g]` CLI that installs agentskills.io skill repos from a lock file, then installs `RobDoan/myskills`.

**Architecture:** Single `bin/myskills.js` entry point that resolves a `skill-repos.lock.yml` (local or remote), parses it, and sequentially runs `npx skills add` for each repo. Core logic is extracted into testable functions. No new dependencies.

**Tech Stack:** Node.js (ES modules), `yaml` package (existing), `node:child_process`, `node:fs/promises`, global `fetch`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `bin/myskills.js` | Create | CLI entry point — arg parsing, orchestration, `main()` |
| `lib/install.js` | Create | Core logic — lock file resolution, repo URL parsing, skill installation |
| `tests/install.test.js` | Create | Unit tests for all `lib/install.js` functions |
| `package.json` | Modify | Add `bin` field |

**Why `lib/install.js` separate from `bin/myskills.js`?** The bin file handles argv parsing and process exit codes. The lib file contains pure, testable functions. This follows the same pattern as `scripts/check-upstream.js` which exports testable functions (`loadReposConfig`, `buildCompareUrl`, etc.) alongside its CLI entrypoint.

---

## Task 1: Core library — lock file loading and URL parsing

**Files:**
- Create: `lib/install.js`
- Create: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for `parseLockFileYaml` and `extractOwnerRepo`**

In `tests/install.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLockFileYaml, extractOwnerRepo } from "../lib/install.js";

describe("parseLockFileYaml", () => {
  it("parses valid lock file YAML and returns repo list", () => {
    const yaml = `repos:
  - name: anthropics-skills
    url: https://github.com/anthropics/skills
    branch: main
    sha: abc123
    checked_at: 2026-04-14T00:00:00.000Z
  - name: vercel-agent-skills
    url: https://github.com/vercel-labs/agent-skills
    branch: main
    sha: def456
    checked_at: 2026-04-14T00:00:00.000Z
`;
    const repos = parseLockFileYaml(yaml);
    assert.equal(repos.length, 2);
    assert.equal(repos[0].url, "https://github.com/anthropics/skills");
    assert.equal(repos[1].url, "https://github.com/vercel-labs/agent-skills");
  });

  it("throws on invalid YAML with no repos key", () => {
    assert.throws(() => parseLockFileYaml("not: valid"), /repos/);
  });
});

describe("extractOwnerRepo", () => {
  it("extracts owner/repo from GitHub URL", () => {
    assert.equal(
      extractOwnerRepo("https://github.com/anthropics/skills"),
      "anthropics/skills"
    );
  });

  it("extracts owner/repo from URL with .git suffix", () => {
    assert.equal(
      extractOwnerRepo("https://github.com/owner/repo.git"),
      "owner/repo"
    );
  });

  it("throws on non-GitHub URL", () => {
    assert.throws(() => extractOwnerRepo("https://gitlab.com/a/b"), /GitHub/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js`
Expected: FAIL — `lib/install.js` does not exist.

- [ ] **Step 3: Implement `parseLockFileYaml` and `extractOwnerRepo`**

Create `lib/install.js`:

```js
import { parse as parseYaml } from "yaml";

export function parseLockFileYaml(content) {
  const parsed = parseYaml(content);
  if (!parsed || !Array.isArray(parsed.repos)) {
    throw new Error("Invalid lock file: missing repos key");
  }
  return parsed.repos;
}

export function extractOwnerRepo(url) {
  const match = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Cannot parse GitHub URL: ${url}`);
  }
  return match[1];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add lock file parsing and URL extraction"
```

---

## Task 2: Lock file resolution — local file or remote fetch

**Files:**
- Modify: `lib/install.js`
- Modify: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for `resolveLockFileContent`**

Append to `tests/install.test.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveLockFileContent } from "../lib/install.js";

const SAMPLE_LOCK_YAML = `repos:
  - name: anthropics-skills
    url: https://github.com/anthropics/skills
    branch: main
    sha: abc123
    checked_at: 2026-04-14T00:00:00.000Z
`;

describe("resolveLockFileContent", () => {
  it("reads local skill-repos.lock.yml when present", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));
    await fs.writeFile(path.join(tmpDir, "skill-repos.lock.yml"), SAMPLE_LOCK_YAML);

    const { content, source } = await resolveLockFileContent(tmpDir);
    assert.equal(source, "local");
    assert.ok(content.includes("anthropics-skills"));

    await fs.rm(tmpDir, { recursive: true });
  });

  it("fetches remote lock file when local is missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));

    const { content, source } = await resolveLockFileContent(tmpDir, async () => ({
      ok: true,
      text: async () => SAMPLE_LOCK_YAML,
    }));
    assert.equal(source, "remote");
    assert.ok(content.includes("anthropics-skills"));

    await fs.rm(tmpDir, { recursive: true });
  });

  it("throws when remote fetch fails", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));

    await assert.rejects(
      () =>
        resolveLockFileContent(tmpDir, async () => ({
          ok: false,
          status: 404,
        })),
      /Failed to fetch/
    );

    await fs.rm(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `node --test tests/install.test.js`
Expected: 3 new tests FAIL — `resolveLockFileContent` not exported.

- [ ] **Step 3: Implement `resolveLockFileContent`**

Add to `lib/install.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";

const LOCK_FILE_NAME = "skill-repos.lock.yml";
const REMOTE_LOCK_URL =
  "https://raw.githubusercontent.com/RobDoan/myskills/main/skill-repos.lock.yml";

export async function resolveLockFileContent(cwd, fetchFn = fetch) {
  const localPath = path.join(cwd, LOCK_FILE_NAME);
  try {
    const content = await fs.readFile(localPath, "utf-8");
    return { content, source: "local" };
  } catch {
    // Local file not found — fetch from remote
  }

  const response = await fetchFn(REMOTE_LOCK_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch remote lock file (HTTP ${response.status})`
    );
  }
  const content = await response.text();
  return { content, source: "remote" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add lock file resolution with local/remote fallback"
```

---

## Task 3: Skill installation via `npx skills add`

**Files:**
- Modify: `lib/install.js`
- Modify: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for `installSkillRepos`**

Append to `tests/install.test.js`:

```js
import { installSkillRepos } from "../lib/install.js";

describe("installSkillRepos", () => {
  it("runs npx skills add for each repo then RobDoan/myskills", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => {
      calls.push({ cmd, args });
    };

    const repos = [
      { name: "anthropics-skills", url: "https://github.com/anthropics/skills" },
      { name: "vercel-agent-skills", url: "https://github.com/vercel-labs/agent-skills" },
    ];

    const result = await installSkillRepos(repos, { global: false, execFn: mockExec });

    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].args, ["skills", "add", "anthropics/skills"]);
    assert.deepEqual(calls[1].args, ["skills", "add", "vercel-labs/agent-skills"]);
    assert.deepEqual(calls[2].args, ["skills", "add", "RobDoan/myskills"]);
    assert.equal(result.installed, 3);
    assert.equal(result.failed, 0);
  });

  it("passes -g flag when global is true", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => {
      calls.push({ cmd, args });
    };

    const repos = [
      { name: "anthropics-skills", url: "https://github.com/anthropics/skills" },
    ];

    await installSkillRepos(repos, { global: true, execFn: mockExec });

    assert.deepEqual(calls[0].args, ["skills", "add", "-g", "anthropics/skills"]);
    assert.deepEqual(calls[1].args, ["skills", "add", "-g", "RobDoan/myskills"]);
  });

  it("continues after a failed install and reports failure", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => {
      calls.push({ cmd, args });
      if (args.includes("anthropics/skills")) {
        throw new Error("install failed");
      }
    };

    const repos = [
      { name: "anthropics-skills", url: "https://github.com/anthropics/skills" },
      { name: "vercel-agent-skills", url: "https://github.com/vercel-labs/agent-skills" },
    ];

    const result = await installSkillRepos(repos, { global: false, execFn: mockExec });

    assert.equal(calls.length, 3);
    assert.equal(result.installed, 2);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.failures, ["anthropics/skills"]);
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `node --test tests/install.test.js`
Expected: 3 new tests FAIL — `installSkillRepos` not exported.

- [ ] **Step 3: Implement `installSkillRepos`**

Add to `lib/install.js`:

```js
const SELF_REPO = "RobDoan/myskills";

export async function installSkillRepos(repos, { global: isGlobal = false, execFn }) {
  const repoIds = repos.map((r) => extractOwnerRepo(r.url));
  repoIds.push(SELF_REPO);

  let installed = 0;
  let failed = 0;
  const failures = [];

  for (const repoId of repoIds) {
    const args = isGlobal
      ? ["skills", "add", "-g", repoId]
      : ["skills", "add", repoId];
    try {
      await execFn("npx", args);
      installed++;
    } catch {
      failed++;
      failures.push(repoId);
    }
  }

  return { installed, failed, failures };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add skill repo installation with npx skills add"
```

---

## Task 4: CLI entry point and package.json bin field

**Files:**
- Create: `bin/myskills.js`
- Modify: `package.json`
- Modify: `tests/install.test.js`

- [ ] **Step 1: Write failing test for `parseArgs`**

Append to `tests/install.test.js`:

```js
import { parseArgs } from "../lib/install.js";

describe("parseArgs", () => {
  it("parses install command", () => {
    const result = parseArgs(["node", "myskills", "install"]);
    assert.equal(result.command, "install");
    assert.equal(result.global, false);
  });

  it("parses install -g", () => {
    const result = parseArgs(["node", "myskills", "install", "-g"]);
    assert.equal(result.command, "install");
    assert.equal(result.global, true);
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

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `node --test tests/install.test.js`
Expected: 4 new tests FAIL — `parseArgs` not exported.

- [ ] **Step 3: Implement `parseArgs`**

Add to `lib/install.js`:

```js
export function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] === "install" ? "install" : null;
  const isGlobal = args.includes("-g");
  return { command, global: isGlobal };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: All 15 tests PASS.

- [ ] **Step 5: Create the bin entry point**

Create `bin/myskills.js`:

```js
#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  parseArgs,
  resolveLockFileContent,
  parseLockFileYaml,
  installSkillRepos,
} from "../lib/install.js";

const execFileAsync = promisify(execFile);

const USAGE = `Usage: myskills install [-g]

Install agentskills.io skill repos from skill-repos.lock.yml.

Options:
  -g    Install skills globally`;

const { command, global: isGlobal } = parseArgs(process.argv);

if (command !== "install") {
  console.error(USAGE);
  process.exit(1);
}

try {
  const cwd = process.cwd();
  const { content, source } = await resolveLockFileContent(cwd);

  if (source === "local") {
    console.log("Using local skill-repos.lock.yml");
  } else {
    console.log("Fetching skill-repos.lock.yml from RobDoan/myskills...");
  }

  const repos = parseLockFileYaml(content);

  const execFn = async (cmd, args) => {
    await execFileAsync(cmd, args, { stdio: "inherit" });
  };

  const result = await installSkillRepos(repos, {
    global: isGlobal,
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
```

- [ ] **Step 6: Make bin file executable**

Run: `chmod +x bin/myskills.js`

- [ ] **Step 7: Add `bin` field and update `files` in `package.json`**

Add the `bin` field to `package.json`:

```json
{
  "bin": {
    "myskills": "bin/myskills.js"
  }
}
```

- [ ] **Step 8: Run all tests to verify nothing is broken**

Run: `node --test 'tests/**/*.test.js'`
Expected: All tests PASS (15 in install.test.js + existing tests).

- [ ] **Step 9: Commit**

```bash
git add bin/myskills.js lib/install.js tests/install.test.js package.json
git commit -m "feat: add myskills install CLI entry point"
```

---

## Task 5: Add console output logging to `installSkillRepos`

**Files:**
- Modify: `lib/install.js`
- Modify: `tests/install.test.js`

- [ ] **Step 1: Write failing test for log output**

Append to `tests/install.test.js`:

```js
describe("installSkillRepos logging", () => {
  it("logs each repo being installed", async () => {
    const logs = [];
    const mockExec = async () => {};
    const mockLog = (msg) => logs.push(msg);

    const repos = [
      { name: "anthropics-skills", url: "https://github.com/anthropics/skills" },
    ];

    await installSkillRepos(repos, { global: false, execFn: mockExec, log: mockLog });

    assert.ok(logs.some((l) => l.includes("anthropics/skills")));
    assert.ok(logs.some((l) => l.includes("RobDoan/myskills")));
  });

  it("logs failure for failed repo", async () => {
    const logs = [];
    const mockExec = async (cmd, args) => {
      if (args.includes("anthropics/skills")) throw new Error("fail");
    };
    const mockLog = (msg) => logs.push(msg);

    const repos = [
      { name: "anthropics-skills", url: "https://github.com/anthropics/skills" },
    ];

    await installSkillRepos(repos, { global: false, execFn: mockExec, log: mockLog });

    assert.ok(logs.some((l) => l.includes("Failed") && l.includes("anthropics/skills")));
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `node --test tests/install.test.js`
Expected: 2 new tests FAIL — `installSkillRepos` doesn't accept/use `log` yet.

- [ ] **Step 3: Add logging to `installSkillRepos`**

Update the `installSkillRepos` function in `lib/install.js` to accept and use a `log` parameter:

```js
export async function installSkillRepos(repos, { global: isGlobal = false, execFn, log = () => {} }) {
  const repoIds = repos.map((r) => extractOwnerRepo(r.url));
  repoIds.push(SELF_REPO);

  let installed = 0;
  let failed = 0;
  const failures = [];

  for (const repoId of repoIds) {
    log(`Installing ${repoId}...`);
    const args = isGlobal
      ? ["skills", "add", "-g", repoId]
      : ["skills", "add", repoId];
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

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test 'tests/**/*.test.js'`
Expected: All tests PASS (17 in install.test.js + existing tests).

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add logging to skill installation"
```

---

## Task 6: Manual smoke test

**Files:** None (verification only)

- [ ] **Step 1: Verify the CLI shows usage on no args**

Run: `node bin/myskills.js`
Expected output:
```
Usage: myskills install [-g]

Install agentskills.io skill repos from skill-repos.lock.yml.

Options:
  -g    Install skills globally
```
Exit code: 1

- [ ] **Step 2: Verify the CLI resolves the local lock file**

Run from the project root (which has `skill-repos.lock.yml`):

Run: `node bin/myskills.js install 2>&1 | head -1`
Expected first line: `Using local skill-repos.lock.yml`

(It will then try to run `npx skills add` which may fail if `skills` CLI is not installed — that's fine, the lock file resolution is what we're verifying.)

- [ ] **Step 3: Run full test suite one final time**

Run: `node --test 'tests/**/*.test.js'`
Expected: All tests PASS.

- [ ] **Step 4: Commit any fixes if needed, otherwise skip**

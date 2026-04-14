# myskills add Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `add` subcommand and refactor `install` to use `skill-repos.yml` instead of `skill-repos.lock.yml`.

**Architecture:** Extend `lib/install.js` with renamed functions (lock → config), new `addRepoToConfig()` and `saveConfigFile()` functions. `bin/myskills.js` gains an `add` command that orchestrates: resolve config → install all → add new repo → update config file.

**Tech Stack:** Node.js ESM, `yaml` package for YAML parse/stringify, `node:test` + `node:assert/strict` for tests.

---

### Task 1: Refactor `lib/install.js` — rename lock file references to config file

**Files:**
- Modify: `lib/install.js`
- Modify: `tests/install.test.js`

- [ ] **Step 1: Write failing tests with new function names**

In `tests/install.test.js`, update the import line and all test descriptions/calls to use the new names. The old names will no longer exist, so the tests should fail on import.

Replace the import at line 6:

```js
import { parseConfigYaml, extractOwnerRepo, resolveConfigContent, installSkillRepos, parseArgs } from "../lib/install.js";
```

Rename test suites and calls throughout the file:
- `describe("parseLockFileYaml"` → `describe("parseConfigYaml"`
- All calls to `parseLockFileYaml(...)` → `parseConfigYaml(...)`
- `describe("resolveLockFileContent"` → `describe("resolveConfigContent"`
- All calls to `resolveLockFileContent(...)` → `resolveConfigContent(...)`
- `SAMPLE_LOCK_YAML` → `SAMPLE_CONFIG_YAML`
- In the `resolveConfigContent` tests, change the local file written from `"skill-repos.lock.yml"` to `"skill-repos.yml"`
- Update test description strings: `"reads local skill-repos.lock.yml when present"` → `"reads local skill-repos.yml when present"`
- `"fetches remote lock file when local is missing"` → `"fetches remote config file when local is missing"`
- `"throws when remote fetch fails"` stays the same (no "lock" reference)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js`
Expected: FAIL — `parseConfigYaml` is not exported from `lib/install.js`

- [ ] **Step 3: Rename functions and constants in `lib/install.js`**

In `lib/install.js`, make these changes:

```js
const CONFIG_FILE_NAME = "skill-repos.yml";
const REMOTE_CONFIG_URL =
  "https://raw.githubusercontent.com/RobDoan/myskills/main/skill-repos.yml";

export async function resolveConfigContent(cwd, fetchFn = fetch) {
  const localPath = path.join(cwd, CONFIG_FILE_NAME);
  try {
    const content = await fs.readFile(localPath, "utf-8");
    return { content, source: "local" };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const response = await fetchFn(REMOTE_CONFIG_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch remote config file (HTTP ${response.status})`
    );
  }
  const content = await response.text();
  return { content, source: "remote" };
}

export function parseConfigYaml(content) {
  const parsed = parseYaml(content);
  if (!parsed || !Array.isArray(parsed.repos)) {
    throw new Error("Invalid config file: missing repos key");
  }
  return parsed.repos;
}
```

Remove the old `LOCK_FILE_NAME`, `REMOTE_LOCK_URL`, `resolveLockFileContent`, and `parseLockFileYaml` identifiers entirely.

- [ ] **Step 4: Update `bin/myskills.js` to use new function names**

In `bin/myskills.js`, update the import at line 4:

```js
import {
  parseArgs,
  resolveConfigContent,
  parseConfigYaml,
  installSkillRepos,
} from "../lib/install.js";
```

Update the USAGE string:

```js
const USAGE = `Usage: myskills <command>

Commands:
  install [-g]       Install skill repos from skill-repos.yml
  add <repo>         Install all skills, add a new repo, and update config`;
```

Update the function calls in the install block:

```js
  const { content, source } = await resolveConfigContent(cwd);

  if (source === "local") {
    console.log("Using local skill-repos.yml");
  } else {
    console.log("Fetching skill-repos.yml from RobDoan/myskills...");
  }

  const repos = parseConfigYaml(content);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/install.js bin/myskills.js tests/install.test.js
git commit -m "refactor: rename lock file references to config file in install module"
```

---

### Task 2: Add `parseArgs` support for the `add` command

**Files:**
- Modify: `lib/install.js`
- Modify: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for `parseArgs` with `add` command**

Append to the existing `describe("parseArgs"` block in `tests/install.test.js`:

```js
  it("parses add command with repo argument", () => {
    const result = parseArgs(["node", "myskills", "add", "someuser/somerepo"]);
    assert.equal(result.command, "add");
    assert.equal(result.repo, "someuser/somerepo");
  });

  it("returns null command for add without repo argument", () => {
    const result = parseArgs(["node", "myskills", "add"]);
    assert.equal(result.command, null);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js`
Expected: FAIL — `result.command` is `null` for `add someuser/somerepo`, and `result.repo` is `undefined`

- [ ] **Step 3: Update `parseArgs` in `lib/install.js`**

Replace the existing `parseArgs` function:

```js
export function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const isGlobal = args.includes("-g");

  if (command === "install") {
    return { command: "install", global: isGlobal };
  }

  if (command === "add" && args[1]) {
    return { command: "add", repo: args[1] };
  }

  return { command: null, global: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add parseArgs support for add command"
```

---

### Task 3: Implement `addRepoToConfig()` and `saveConfigFile()`

**Files:**
- Modify: `lib/install.js`
- Modify: `tests/install.test.js`

- [ ] **Step 1: Write failing tests for `addRepoToConfig`**

Add a new import for `addRepoToConfig` and `saveConfigFile` in `tests/install.test.js`. Update the import line:

```js
import { parseConfigYaml, extractOwnerRepo, resolveConfigContent, installSkillRepos, parseArgs, addRepoToConfig, saveConfigFile } from "../lib/install.js";
```

Add new test suites at the end of the file:

```js
describe("addRepoToConfig", () => {
  it("appends a new repo entry to config YAML", () => {
    const input = `repos:
  - name: anthropics-skills
    url: https://github.com/anthropics/skills
`;
    const result = addRepoToConfig(input, "someuser/somerepo");
    const parsed = parseConfigYaml(result);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1].name, "someuser-somerepo");
    assert.equal(parsed[1].url, "https://github.com/someuser/somerepo");
  });

  it("returns null when repo already exists in config", () => {
    const input = `repos:
  - name: anthropics-skills
    url: https://github.com/anthropics/skills
`;
    const result = addRepoToConfig(input, "anthropics/skills");
    assert.equal(result, null);
  });

  it("works with empty repos list", () => {
    const input = `repos: []\n`;
    const result = addRepoToConfig(input, "someuser/somerepo");
    const parsed = parseConfigYaml(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "someuser-somerepo");
    assert.equal(parsed[0].url, "https://github.com/someuser/somerepo");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js`
Expected: FAIL — `addRepoToConfig` is not exported

- [ ] **Step 3: Implement `addRepoToConfig` and `saveConfigFile` in `lib/install.js`**

Add `stringify as stringifyYaml` to the yaml import at line 1:

```js
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
```

Add the two new functions after the existing `parseArgs` function:

```js
export function addRepoToConfig(configContent, repoId) {
  const parsed = parseYaml(configContent);
  const repos = parsed?.repos || [];
  const newUrl = `https://github.com/${repoId}`;

  const exists = repos.some((r) => r.url === newUrl);
  if (exists) {
    return null;
  }

  const name = repoId.replace("/", "-");
  repos.push({ name, url: newUrl });
  parsed.repos = repos;
  return stringifyYaml(parsed);
}

export async function saveConfigFile(cwd, content) {
  const filePath = path.join(cwd, CONFIG_FILE_NAME);
  await fs.writeFile(filePath, content, "utf-8");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: All tests PASS

- [ ] **Step 5: Write failing test for `saveConfigFile`**

Add to the test file:

```js
describe("saveConfigFile", () => {
  it("writes config content to skill-repos.yml in given directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));
    const content = `repos:\n  - name: test\n    url: https://github.com/test/repo\n`;

    await saveConfigFile(tmpDir, content);

    const written = await fs.readFile(path.join(tmpDir, "skill-repos.yml"), "utf-8");
    assert.equal(written, content);

    await fs.rm(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: All tests PASS (the implementation was already added in Step 3)

- [ ] **Step 7: Commit**

```bash
git add lib/install.js tests/install.test.js
git commit -m "feat: add addRepoToConfig and saveConfigFile functions"
```

---

### Task 4: Wire up the `add` command in `bin/myskills.js`

**Files:**
- Modify: `bin/myskills.js`

- [ ] **Step 1: Update imports in `bin/myskills.js`**

Replace the import block:

```js
import { spawn } from "node:child_process";
import {
  parseArgs,
  resolveConfigContent,
  parseConfigYaml,
  installSkillRepos,
  addRepoToConfig,
  saveConfigFile,
  extractOwnerRepo,
} from "../lib/install.js";
```

- [ ] **Step 2: Refactor `bin/myskills.js` to handle both commands**

Replace the entire file content after imports with:

```js
const USAGE = `Usage: myskills <command>

Commands:
  install [-g]       Install skill repos from skill-repos.yml
  add <repo>         Install all skills, add a new repo, and update config`;

const { command, global: isGlobal, repo } = parseArgs(process.argv);

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

    const repos = parseConfigYaml(content);

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
} else if (command === "add") {
  try {
    const cwd = process.cwd();

    // Step 1: Resolve config (download if no local copy)
    const { content, source } = await resolveConfigContent(cwd);

    if (source === "remote") {
      console.log("Fetching skill-repos.yml from RobDoan/myskills...");
      await saveConfigFile(cwd, content);
    } else {
      console.log("Using local skill-repos.yml");
    }

    // Step 2: Check if repo already in config
    const updated = addRepoToConfig(content, repo);
    if (updated === null) {
      console.log(`${repo} already exists in skill-repos.yml, skipping.`);
      process.exit(0);
    }

    // Step 3: Install all existing repos from config
    const repos = parseConfigYaml(content);
    const installResult = await installSkillRepos(repos, {
      global: false,
      execFn,
      log: (msg) => console.log(msg),
    });

    if (installResult.failed > 0) {
      console.error(`\nFailed to install: ${installResult.failures.join(", ")}`);
      console.log(`Done. ${installResult.installed} installed, ${installResult.failed} failed.`);
      process.exit(1);
    }

    // Step 4: Install the new repo
    console.log(`Installing ${repo}...`);
    try {
      await execFn("npx", ["skills", "add", repo]);
    } catch {
      console.error(`Failed to install ${repo}. Config not updated.`);
      process.exit(1);
    }

    // Step 5: Update config file
    await saveConfigFile(cwd, updated);
    console.log(`Added ${repo} to skill-repos.yml`);
    console.log("Done.");
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
} else {
  console.error(USAGE);
  process.exit(1);
}
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add bin/myskills.js
git commit -m "feat: add 'add' command to myskills CLI"
```

---

### Task 5: Manual smoke test

- [ ] **Step 1: Verify install command still works**

Run: `node bin/myskills.js install`
Expected: Installs all repos from `skill-repos.yml`, prints status for each.

- [ ] **Step 2: Verify add command with new repo**

Run: `node bin/myskills.js add test-org/test-skills`
Expected: Installs existing repos first, then installs `test-org/test-skills`, appends to `skill-repos.yml`.

- [ ] **Step 3: Verify add command with existing repo**

Run: `node bin/myskills.js add anthropics/skills`
Expected: Prints "anthropics/skills already exists in skill-repos.yml, skipping." and exits.

- [ ] **Step 4: Verify help text**

Run: `node bin/myskills.js`
Expected: Prints usage with both `install` and `add` commands listed.

- [ ] **Step 5: Commit any fixes if needed**

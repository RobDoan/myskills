import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  loadReposConfig,
  loadLockFile,
  buildCompareUrl,
  buildIssueTitle,
} from "../scripts/check-upstream.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("loadReposConfig", () => {
  it("parses a valid skill-repos.yml", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));
    const yml = `repos:\n  - name: test-repo\n    url: https://github.com/owner/repo\n    branch: main\n`;
    await fs.writeFile(path.join(tmpDir, "skill-repos.yml"), yml);

    const result = await loadReposConfig(
      path.join(tmpDir, "skill-repos.yml")
    );
    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].name, "test-repo");
    assert.equal(result.repos[0].branch, "main");

    await fs.rm(tmpDir, { recursive: true });
  });
});

describe("loadLockFile", () => {
  it("returns empty repos array for empty lock file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));
    await fs.writeFile(
      path.join(tmpDir, "skill-repos.lock.yml"),
      "repos: []\n"
    );

    const result = await loadLockFile(
      path.join(tmpDir, "skill-repos.lock.yml")
    );
    assert.deepEqual(result.repos, []);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("returns empty repos when lock file does not exist", async () => {
    const result = await loadLockFile("/nonexistent/path/lock.yml");
    assert.deepEqual(result.repos, []);
  });
});

describe("buildCompareUrl", () => {
  it("builds correct GitHub compare URL", () => {
    const url = buildCompareUrl(
      "https://github.com/anthropics/skills",
      "abc123",
      "def456"
    );
    assert.equal(
      url,
      "https://github.com/anthropics/skills/compare/abc123...def456"
    );
  });
});

describe("buildIssueTitle", () => {
  it("builds correct issue title", () => {
    const title = buildIssueTitle("anthropics-skills");
    assert.equal(title, "Upstream update: anthropics-skills");
  });
});

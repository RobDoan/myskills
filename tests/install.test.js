import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseLockFileYaml, extractOwnerRepo, resolveLockFileContent } from "../lib/install.js";

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

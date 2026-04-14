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

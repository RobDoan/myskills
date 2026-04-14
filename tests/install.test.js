import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseConfigYaml, extractOwnerRepo, resolveConfigContent, installSkillRepos, parseArgs, buildAddArgs, resolveActiveScopes, collectRepoEntries } from "../lib/install.js";

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

const SAMPLE_CONFIG_YAML = `repos:
  - name: anthropics-skills
    url: https://github.com/anthropics/skills
    branch: main
    sha: abc123
    checked_at: 2026-04-14T00:00:00.000Z
`;

describe("resolveConfigContent", () => {
  it("reads local skill-repos.yml when present", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));
    await fs.writeFile(path.join(tmpDir, "skill-repos.yml"), SAMPLE_CONFIG_YAML);

    const { content, source } = await resolveConfigContent(tmpDir);
    assert.equal(source, "local");
    assert.ok(content.includes("anthropics-skills"));

    await fs.rm(tmpDir, { recursive: true });
  });

  it("fetches remote config file when local is missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));

    const { content, source } = await resolveConfigContent(tmpDir, async () => ({
      ok: true,
      text: async () => SAMPLE_CONFIG_YAML,
    }));
    assert.equal(source, "remote");
    assert.ok(content.includes("anthropics-skills"));

    await fs.rm(tmpDir, { recursive: true });
  });

  it("throws when remote fetch fails", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "myskills-"));

    await assert.rejects(
      () =>
        resolveConfigContent(tmpDir, async () => ({
          ok: false,
          status: 404,
        })),
      /Failed to fetch/
    );

    await fs.rm(tmpDir, { recursive: true });
  });
});

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

describe("buildAddArgs", () => {
  it("builds args with -p for non-global", () => {
    const args = buildAddArgs("owner/repo");
    assert.deepEqual(args, ["skills", "add", "-p", "owner/repo"]);
  });

  it("builds args with -g for global", () => {
    const args = buildAddArgs("owner/repo", { global: true });
    assert.deepEqual(args, ["skills", "add", "-g", "owner/repo"]);
  });

  it("appends --skill with skill names when skills provided", () => {
    const args = buildAddArgs("owner/repo", { skills: ["pr-review", "commit"] });
    assert.deepEqual(args, ["skills", "add", "-p", "owner/repo", "--skill", "pr-review", "commit"]);
  });

  it("appends --skill with -g when global and skills provided", () => {
    const args = buildAddArgs("owner/repo", { global: true, skills: ["pr-review"] });
    assert.deepEqual(args, ["skills", "add", "-g", "owner/repo", "--skill", "pr-review"]);
  });

  it("does not append --skill when skills array is empty", () => {
    const args = buildAddArgs("owner/repo", { skills: [] });
    assert.deepEqual(args, ["skills", "add", "-p", "owner/repo"]);
  });
});

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


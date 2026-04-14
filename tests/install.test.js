import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseConfigYaml, extractOwnerRepo, resolveConfigContent, installSkillRepos, parseArgs, buildAddArgs } from "../lib/install.js";

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
    assert.deepEqual(calls[0].args, ["skills", "add", "-p", "anthropics/skills"]);
    assert.deepEqual(calls[1].args, ["skills", "add", "-p", "vercel-labs/agent-skills"]);
    assert.deepEqual(calls[2].args, ["skills", "add", "-p", "RobDoan/myskills"]);
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

describe("installSkillRepos with skills", () => {
  it("passes --skill args when repo has skills array", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => {
      calls.push({ cmd, args });
    };

    const repos = [
      { name: "anthropics-skills", url: "https://github.com/anthropics/skills", skills: ["pr-review", "commit"] },
    ];

    await installSkillRepos(repos, { global: false, execFn: mockExec });

    assert.deepEqual(calls[0].args, ["skills", "add", "-p", "anthropics/skills", "--skill", "pr-review", "commit"]);
    assert.deepEqual(calls[1].args, ["skills", "add", "-p", "RobDoan/myskills"]);
  });

  it("does not pass --skill when repo has no skills array", async () => {
    const calls = [];
    const mockExec = async (cmd, args) => {
      calls.push({ cmd, args });
    };

    const repos = [
      { name: "anthropics-skills", url: "https://github.com/anthropics/skills" },
    ];

    await installSkillRepos(repos, { global: false, execFn: mockExec });

    assert.deepEqual(calls[0].args, ["skills", "add", "-p", "anthropics/skills"]);
  });
});

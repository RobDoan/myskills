import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseConfigYaml, extractOwnerRepo, resolveConfigContent, installSkillRepos, parseArgs, addRepoToConfig, saveConfigFile } from "../lib/install.js";

describe("parseConfigYaml", () => {
  it("parses valid config YAML and returns repo list", () => {
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
    const repos = parseConfigYaml(yaml);
    assert.equal(repos.length, 2);
    assert.equal(repos[0].url, "https://github.com/anthropics/skills");
    assert.equal(repos[1].url, "https://github.com/vercel-labs/agent-skills");
  });

  it("throws on invalid YAML with no repos key", () => {
    assert.throws(() => parseConfigYaml("not: valid"), /repos/);
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

  it("parses add command with repo argument", () => {
    const result = parseArgs(["node", "myskills", "add", "someuser/somerepo"]);
    assert.equal(result.command, "add");
    assert.equal(result.repo, "someuser/somerepo");
  });

  it("returns null command for add without repo argument", () => {
    const result = parseArgs(["node", "myskills", "add"]);
    assert.equal(result.command, null);
  });
});

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

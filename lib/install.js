import { parse as parseYaml } from "yaml";
import fs from "node:fs/promises";
import path from "node:path";

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

export function extractOwnerRepo(url) {
  const match = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Cannot parse GitHub URL: ${url}`);
  }
  return match[1];
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const isGlobal = args.includes("-g");

  if (command === "install") {
    return { command: "install", global: isGlobal };
  }

  return { command: null, global: false };
}

const SELF_REPO = "RobDoan/myskills";

export function buildAddArgs(repoId, { global: isGlobal = false, skills = [] } = {}) {
  const args = isGlobal
    ? ["skills", "add", "-g", repoId]
    : ["skills", "add", "-p", repoId];
  if (skills.length > 0) {
    args.push("--skill", ...skills);
  }
  return args;
}

export async function installSkillRepos(repos, { global: isGlobal = false, execFn, log = () => {} }) {
  const entries = repos.map((r) => ({
    repoId: extractOwnerRepo(r.url),
    skills: r.skills || [],
  }));
  entries.push({ repoId: SELF_REPO, skills: [] });

  let installed = 0;
  let failed = 0;
  const failures = [];

  for (const { repoId, skills } of entries) {
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

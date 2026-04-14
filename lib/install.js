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
  if (!parsed || !Array.isArray(parsed.repos)) {
    throw new Error("Invalid config file: missing repos key");
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

const SELF_REPO = "RobDoan/myskills";

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

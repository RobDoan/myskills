import { parse as parseYaml } from "yaml";
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
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
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

export function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] === "install" ? "install" : null;
  const isGlobal = args.includes("-g");
  return { command, global: isGlobal };
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

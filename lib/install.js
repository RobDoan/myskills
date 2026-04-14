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
  } catch {
    // Local file not found — fetch from remote
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

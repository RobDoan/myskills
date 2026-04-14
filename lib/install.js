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

  let scopes = null;
  const sIndex = args.indexOf("-s");
  if (sIndex !== -1 && sIndex + 1 < args.length) {
    scopes = args[sIndex + 1].split(",").filter(Boolean);
  }

  if (command === "install") {
    return { command: "install", global: isGlobal, scopes };
  }

  return { command: null, global: false, scopes: null };
}

export function resolveActiveScopes(scopeMap, scopes) {
  if (scopes === null) {
    return Object.keys(scopeMap);
  }
  const available = Object.keys(scopeMap);
  const unknown = scopes.filter((s) => !available.includes(s));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown scope(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`
    );
  }
  return [...new Set(["default", ...scopes])];
}

export function collectRepoEntries(scopeMap, activeScopes) {
  const merged = new Map();
  for (const scope of activeScopes) {
    for (const entry of scopeMap[scope] || []) {
      if (!merged.has(entry.url)) {
        merged.set(entry.url, { url: entry.url, skills: [...entry.skills] });
      } else {
        const existing = merged.get(entry.url);
        for (const skill of entry.skills) {
          if (!existing.skills.includes(skill)) {
            existing.skills.push(skill);
          }
        }
      }
    }
  }
  return [...merged.values()];
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

export async function installSkillRepos(scopeMap, { global: isGlobal = false, scopes = null, execFn, log = () => {} }) {
  const activeScopes = resolveActiveScopes(scopeMap, scopes);
  const allEntries = collectRepoEntries(scopeMap, activeScopes);

  // Separate self-repo from other repos
  const selfEntry = allEntries.find((e) => e.url === SELF_REPO);
  const otherEntries = allEntries.filter((e) => e.url !== SELF_REPO);

  // Build install queue: self-repo first
  const queue = [];
  if (selfEntry) {
    queue.push({ repoId: SELF_REPO, skills: selfEntry.skills });
  } else {
    queue.push({ repoId: SELF_REPO, skills: [] });
  }
  for (const entry of otherEntries) {
    queue.push({ repoId: entry.url, skills: entry.skills });
  }

  let installed = 0;
  let failed = 0;
  const failures = [];

  for (const { repoId, skills } of queue) {
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

import { parse as parseYaml } from "yaml";

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

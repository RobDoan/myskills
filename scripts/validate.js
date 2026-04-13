import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_NAME_LEN = 64;
const MAX_DESC_LEN = 1024;

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return parseYaml(match[1]);
}

export async function validateSkillDir(dirPath) {
  const errors = [];
  const dirName = path.basename(dirPath);
  const skillMdPath = path.join(dirPath, "SKILL.md");

  let content;
  try {
    content = await fs.readFile(skillMdPath, "utf-8");
  } catch {
    errors.push(`${dirName}: SKILL.md not found`);
    return { valid: false, errors };
  }

  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    errors.push(`${dirName}: No valid YAML frontmatter found`);
    return { valid: false, errors };
  }

  // Validate name
  if (!frontmatter.name) {
    errors.push(`${dirName}: Missing required field "name"`);
  } else {
    if (typeof frontmatter.name !== "string") {
      errors.push(`${dirName}: "name" must be a string`);
    } else {
      if (frontmatter.name.length > MAX_NAME_LEN) {
        errors.push(`${dirName}: "name" exceeds ${MAX_NAME_LEN} characters`);
      }
      if (!NAME_REGEX.test(frontmatter.name)) {
        errors.push(`${dirName}: "name" must be lowercase letters, numbers, and hyphens only (no leading/trailing/consecutive hyphens)`);
      }
      if (frontmatter.name !== dirName) {
        errors.push(`${dirName}: "name" (${frontmatter.name}) does not match directory name (${dirName})`);
      }
    }
  }

  // Validate description
  if (!frontmatter.description) {
    errors.push(`${dirName}: Missing required field "description"`);
  } else if (typeof frontmatter.description !== "string") {
    errors.push(`${dirName}: "description" must be a string`);
  } else if (frontmatter.description.length > MAX_DESC_LEN) {
    errors.push(`${dirName}: "description" exceeds ${MAX_DESC_LEN} characters`);
  }

  return { valid: errors.length === 0, errors };
}

export async function validateSkillsRoot(rootPath) {
  const errors = [];
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());

  for (const dir of dirs) {
    const dirPath = path.join(rootPath, dir.name);
    const skillMdPath = path.join(dirPath, "SKILL.md");

    try {
      await fs.access(skillMdPath);
      const result = await validateSkillDir(dirPath);
      errors.push(...result.errors);
    } catch {
      errors.push(`Orphan directory: ${dir.name} (no SKILL.md found)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// CLI entrypoint
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const skillsDir = path.resolve(process.cwd(), "skills");

  try {
    await fs.access(skillsDir);
  } catch {
    console.log("No skills/ directory found. Nothing to validate.");
    process.exit(0);
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());

  if (dirs.length === 0) {
    console.log("No skill directories found in skills/. Nothing to validate.");
    process.exit(0);
  }

  const result = await validateSkillsRoot(skillsDir);

  if (result.valid) {
    console.log(`All ${dirs.length} skill(s) valid.`);
    process.exit(0);
  } else {
    console.error("Validation failed:");
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
}

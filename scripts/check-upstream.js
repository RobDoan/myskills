import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { Octokit } from "@octokit/rest";

export async function loadReposConfig(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  return parseYaml(content);
}

export async function loadLockFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseYaml(content) || { repos: [] };
  } catch {
    return { repos: [] };
  }
}

export function buildCompareUrl(repoUrl, oldSha, newSha) {
  return `${repoUrl}/compare/${oldSha}...${newSha}`;
}

export function buildIssueTitle(repoName) {
  return `Upstream update: ${repoName}`;
}

function parseGitHubUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error(`Cannot parse GitHub URL: ${url}`);
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

// CLI entrypoint
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN environment variable is required.");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  const rootDir = process.cwd();
  const configPath = path.join(rootDir, "skill-repos.yml");
  const lockPath = path.join(rootDir, "skill-repos.lock.yml");

  const config = await loadReposConfig(configPath);
  const lock = await loadLockFile(lockPath);

  const { GITHUB_REPOSITORY } = process.env;
  let issueOwner, issueRepo;
  if (GITHUB_REPOSITORY) {
    [issueOwner, issueRepo] = GITHUB_REPOSITORY.split("/");
  } else {
    console.error(
      "GITHUB_REPOSITORY environment variable is required (format: owner/repo)."
    );
    process.exit(1);
  }

  const updatedLockRepos = [];
  let hasChanges = false;

  for (const repo of config.repos) {
    const { owner, repo: repoName } = parseGitHubUrl(repo.url);
    const lockEntry = lock.repos.find((r) => r.name === repo.name);
    const oldSha = lockEntry?.sha || null;

    let currentSha;
    try {
      const { data } = await octokit.repos.getBranch({
        owner,
        repo: repoName,
        branch: repo.branch,
      });
      currentSha = data.commit.sha;
    } catch (err) {
      console.error(`Failed to fetch branch for ${repo.name}: ${err.message}`);
      if (lockEntry) updatedLockRepos.push(lockEntry);
      continue;
    }

    if (oldSha && oldSha !== currentSha) {
      console.log(`Change detected: ${repo.name} (${oldSha} -> ${currentSha})`);

      const issueTitle = buildIssueTitle(repo.name);

      const { data: existingIssues } = await octokit.issues.listForRepo({
        owner: issueOwner,
        repo: issueRepo,
        state: "open",
        labels: "upstream-update",
      });

      const alreadyExists = existingIssues.some(
        (issue) => issue.title === issueTitle
      );

      if (!alreadyExists) {
        const compareUrl = buildCompareUrl(repo.url, oldSha, currentSha);
        await octokit.issues.create({
          owner: issueOwner,
          repo: issueRepo,
          title: issueTitle,
          body: `Upstream repository **${repo.name}** has new changes.\n\n**Repository:** ${repo.url}\n**Branch:** ${repo.branch}\n**Previous SHA:** \`${oldSha}\`\n**Current SHA:** \`${currentSha}\`\n\n**Compare changes:** ${compareUrl}`,
          labels: ["upstream-update"],
        });
        console.log(`Created issue: ${issueTitle}`);
      } else {
        console.log(`Issue already exists for ${repo.name}, skipping.`);
      }

      hasChanges = true;
    } else if (!oldSha) {
      console.log(`Initial tracking: ${repo.name} at ${currentSha}`);
      hasChanges = true;
    } else {
      console.log(`No changes: ${repo.name}`);
    }

    updatedLockRepos.push({
      name: repo.name,
      url: repo.url,
      branch: repo.branch,
      sha: currentSha,
      checked_at: new Date().toISOString(),
    });
  }

  // Always write lock file to update checked_at timestamps
  const lockContent = stringifyYaml({ repos: updatedLockRepos });
  await fs.writeFile(lockPath, lockContent);
  console.log("Updated skill-repos.lock.yml");

  if (!hasChanges) {
    console.log("No upstream changes detected.");
  }
}
